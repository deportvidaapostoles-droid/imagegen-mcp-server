import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import {
  AuthError,
  authenticateRequest,
  buildChallenge,
  extractBearerToken,
  getAuthConfig,
  isAuthEnabled,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  type AuthConfig,
} from './auth.js';

const ISSUER = 'https://idp.example.com';
const AUDIENCE = 'https://imagegen.example.com/mcp';

let jwksServer: Server;
let jwksUri: string;
let privateKey: KeyLike;

async function sign(claims: Record<string, unknown>, overrides: { audience?: string; issuer?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    mode: 'oauth',
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri,
    emailClaim: 'email',
    allowedEmails: ['duena@comercio-uno.com'],
    allowedEmailDomains: [],
    allowedSubjects: [],
    requiredScopes: [],
    warnings: [],
    ...overrides,
  };
}

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256');
  privateKey = keyPair.privateKey as KeyLike;
  const publicJwk: JWK = { ...(await exportJWK(keyPair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const address = jwksServer.address();
  jwksUri = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/jwks`;
});

afterAll(() => {
  jwksServer?.close();
});

describe('getAuthConfig', () => {
  it('defaults to no authentication', () => {
    const parsed = getAuthConfig({} as NodeJS.ProcessEnv);
    expect(parsed.mode).toBe('none');
    expect(isAuthEnabled(parsed)).toBe(false);
  });

  it('warns when an issuer is configured but the mode is not oauth', () => {
    const parsed = getAuthConfig({ MCP_OAUTH_ISSUER: ISSUER } as NodeJS.ProcessEnv);
    expect(parsed.mode).toBe('none');
    expect(parsed.warnings.join(' ')).toContain('UNAUTHENTICATED');
  });

  it('fails closed when oauth is requested without an issuer', () => {
    const parsed = getAuthConfig({ MCP_AUTH_MODE: 'oauth' } as NodeJS.ProcessEnv);
    expect(parsed.configError).toContain('MCP_OAUTH_ISSUER');
  });

  it('fails closed when the resource audience is missing', () => {
    const parsed = getAuthConfig({ MCP_AUTH_MODE: 'oauth', MCP_OAUTH_ISSUER: ISSUER } as NodeJS.ProcessEnv);
    expect(parsed.configError).toContain('MCP_OAUTH_AUDIENCE');
  });

  it('parses the allow-lists and normalizes case', () => {
    const parsed = getAuthConfig({
      MCP_AUTH_MODE: 'oauth',
      MCP_OAUTH_ISSUER: `${ISSUER}/`,
      MCP_OAUTH_AUDIENCE: AUDIENCE,
      MCP_ALLOWED_EMAILS: 'Duena@Comercio-Uno.com, encargada@comercio-dos.com',
      MCP_ALLOWED_EMAIL_DOMAINS: '@Comercio-Dos.com',
    } as NodeJS.ProcessEnv);
    expect(parsed.configError).toBeUndefined();
    expect(parsed.issuer).toBe(ISSUER);
    expect(parsed.allowedEmails).toEqual(['duena@comercio-uno.com', 'encargada@comercio-dos.com']);
    expect(parsed.allowedEmailDomains).toEqual(['comercio-dos.com']);
  });

  it('warns when no allow-list is configured', () => {
    const parsed = getAuthConfig({
      MCP_AUTH_MODE: 'oauth',
      MCP_OAUTH_ISSUER: ISSUER,
      MCP_OAUTH_AUDIENCE: AUDIENCE,
    } as NodeJS.ProcessEnv);
    expect(parsed.warnings.join(' ')).toContain('No allow-list configured');
  });
});

describe('extractBearerToken', () => {
  it('reads the token regardless of header case', () => {
    expect(extractBearerToken({ authorization: 'bearer abc' })).toBe('abc');
    expect(extractBearerToken({ authorization: 'Bearer  abc ' })).toBe('abc');
  });

  it('ignores other schemes and missing headers', () => {
    expect(extractBearerToken({ authorization: 'Basic abc' })).toBeUndefined();
    expect(extractBearerToken({})).toBeUndefined();
  });
});

describe('authenticateRequest', () => {
  it('accepts an allow-listed user', async () => {
    const token = await sign({ sub: 'auth0|1', email: 'duena@comercio-uno.com', email_verified: true, scope: 'mcp:use' });
    const info = await authenticateRequest({ authorization: `Bearer ${token}` }, config());
    expect(info.scopes).toEqual(['mcp:use']);
    expect(info.extra?.email).toBe('duena@comercio-uno.com');
  });

  it('rejects a request without a token', async () => {
    await expect(authenticateRequest({}, config())).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a user outside the allow-list', async () => {
    const token = await sign({ sub: 'auth0|2', email: 'random@internet.com', email_verified: true });
    await expect(authenticateRequest({ authorization: `Bearer ${token}` }, config())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects a token minted for another resource', async () => {
    const token = await sign({ sub: 'auth0|1', email: 'duena@comercio-uno.com' }, { audience: 'https://elsewhere.example' });
    await expect(authenticateRequest({ authorization: `Bearer ${token}` }, config())).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a token from another issuer', async () => {
    const token = await sign({ sub: 'auth0|1', email: 'duena@comercio-uno.com' }, { issuer: 'https://evil.example' });
    await expect(authenticateRequest({ authorization: `Bearer ${token}` }, config())).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a token that is not a JWT', async () => {
    await expect(authenticateRequest({ authorization: 'Bearer not-a-jwt' }, config())).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects an unverified email even when it is allow-listed', async () => {
    const token = await sign({ sub: 'auth0|3', email: 'duena@comercio-uno.com', email_verified: false });
    await expect(authenticateRequest({ authorization: `Bearer ${token}` }, config())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('accepts a namespaced email claim', async () => {
    const token = await sign({ sub: 'auth0|4', 'https://imagegen/email': 'encargada@comercio-dos.com' });
    const info = await authenticateRequest(
      { authorization: `Bearer ${token}` },
      config({ allowedEmails: ['encargada@comercio-dos.com'] })
    );
    expect(info.extra?.email).toBe('encargada@comercio-dos.com');
  });

  it('accepts an allow-listed subject when no email claim is present', async () => {
    const token = await sign({ sub: 'auth0|5' });
    const info = await authenticateRequest(
      { authorization: `Bearer ${token}` },
      config({ allowedEmails: [], allowedSubjects: ['auth0|5'] })
    );
    expect(info.extra?.subject).toBe('auth0|5');
  });

  it('enforces required scopes', async () => {
    const token = await sign({ sub: 'auth0|1', email: 'duena@comercio-uno.com', scope: 'openid' });
    await expect(
      authenticateRequest({ authorization: `Bearer ${token}` }, config({ requiredScopes: ['mcp:use'] }))
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses every request when the configuration is broken', async () => {
    await expect(
      authenticateRequest({ authorization: 'Bearer abc' }, config({ configError: 'missing issuer' }))
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('discovery documents', () => {
  it('builds the RFC 9728 metadata URL with the resource path', () => {
    expect(protectedResourceMetadataUrl('https://x.vercel.app')).toBe(
      'https://x.vercel.app/.well-known/oauth-protected-resource/mcp'
    );
  });

  it('advertises the authorization server', () => {
    const document = protectedResourceMetadata(config(), 'https://x.vercel.app');
    expect(document.resource).toBe(AUDIENCE);
    expect(document.authorization_servers).toEqual([ISSUER]);
  });

  it('includes the error code in the challenge', () => {
    const challenge = buildChallenge('https://x/.well-known/oauth-protected-resource/mcp', new AuthError(401, 'invalid_token', 'expired'));
    expect(challenge).toContain('resource_metadata="https://x/.well-known/oauth-protected-resource/mcp"');
    expect(challenge).toContain('error="invalid_token"');
  });
});
