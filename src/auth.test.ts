import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import {
  AuthError,
  getUploadPageToken,
  matchesUploadPageToken,
  authenticateRequest,
  authenticateStaticRequest,
  extractStaticSecret,
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
    tokens: [],
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

describe('shared-secret mode', () => {
  const secretConfig = (overrides: Partial<AuthConfig> = {}): AuthConfig =>
    config({ mode: 'token', tokens: ['s3cret-uno', 's3cret-dos'], issuer: undefined, audience: undefined, ...overrides });

  const url = (path: string) => new URL(path, 'https://imagegen.example.com');

  it('requires MCP_AUTH_TOKENS when the mode is token', () => {
    const parsed = getAuthConfig({ MCP_AUTH_MODE: 'token' } as NodeJS.ProcessEnv);
    expect(parsed.configError).toContain('MCP_AUTH_TOKENS');
  });

  it('parses the token list', () => {
    const parsed = getAuthConfig({ MCP_AUTH_MODE: 'token', MCP_AUTH_TOKENS: 'a1, b2' } as NodeJS.ProcessEnv);
    expect(parsed.mode).toBe('token');
    expect(parsed.tokens).toEqual(['a1', 'b2']);
    expect(parsed.configError).toBeUndefined();
  });

  it('warns when tokens are set but the mode is none', () => {
    const parsed = getAuthConfig({ MCP_AUTH_TOKENS: 'a1' } as NodeJS.ProcessEnv);
    expect(parsed.warnings.join(' ')).toContain('UNAUTHENTICATED');
  });

  it('reads the secret from the Authorization header', () => {
    expect(extractStaticSecret({ authorization: 'Bearer s3cret-uno' }, url('/mcp'))).toBe('s3cret-uno');
  });

  it('reads the secret from the path, for clients that cannot send headers', () => {
    expect(extractStaticSecret({}, url('/mcp/s3cret-uno'))).toBe('s3cret-uno');
    expect(extractStaticSecret({}, url('/api/mcp/s3cret-uno'))).toBe('s3cret-uno');
  });

  it('reads the secret from the query string', () => {
    expect(extractStaticSecret({}, url('/mcp?token=s3cret-uno'))).toBe('s3cret-uno');
    expect(extractStaticSecret({}, url('/mcp?key=s3cret-uno'))).toBe('s3cret-uno');
  });

  it('accepts any configured token and reports which one was used', () => {
    expect(authenticateStaticRequest({}, url('/mcp/s3cret-dos'), secretConfig()).clientId).toBe('static-token-2');
    expect(
      authenticateStaticRequest({ authorization: 'Bearer s3cret-uno' }, url('/mcp'), secretConfig()).clientId
    ).toBe('static-token-1');
  });

  it('rejects a missing or wrong secret', () => {
    expect(() => authenticateStaticRequest({}, url('/mcp'), secretConfig())).toThrow(AuthError);
    expect(() => authenticateStaticRequest({}, url('/mcp/nope'), secretConfig())).toThrow(AuthError);
    expect(() => authenticateStaticRequest({}, url('/mcp/s3cret-uno/extra'), secretConfig())).toThrow(AuthError);
  });

  it('refuses every request when no token is configured', () => {
    expect(() =>
      authenticateStaticRequest({ authorization: 'Bearer x' }, url('/mcp'), secretConfig({ tokens: [], configError: 'missing tokens' }))
    ).toThrow(/misconfigured/);
  });
});


describe('the upload page credential', () => {
  const env = { UPLOAD_PAGE_TOKEN: 'page-secret' } as NodeJS.ProcessEnv;

  it('is off unless an operator sets one', () => {
    expect(getUploadPageToken({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(getUploadPageToken({ UPLOAD_PAGE_TOKEN: '   ' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(getUploadPageToken(env)).toBe('page-secret');
  });

  it('never matches when none is configured, whatever is presented', () => {
    expect(
      matchesUploadPageToken(
        { authorization: 'Bearer page-secret' },
        undefined,
        {} as NodeJS.ProcessEnv
      )
    ).toBe(false);
  });

  it('accepts the credential from the header or the query, and nothing else', () => {
    expect(matchesUploadPageToken({ authorization: 'Bearer page-secret' }, undefined, env)).toBe(true);
    expect(
      matchesUploadPageToken({}, new URL('https://x.dev/api/upload?token=page-secret'), env)
    ).toBe(true);
    expect(matchesUploadPageToken({ authorization: 'Bearer wrong' }, undefined, env)).toBe(false);
    expect(matchesUploadPageToken({}, undefined, env)).toBe(false);
  });

  it('is separate from the MCP tokens, so publishing it cannot hand out the server', () => {
    const config = getAuthConfig({
      MCP_AUTH_MODE: 'token',
      MCP_AUTH_TOKENS: 'mcp-secret',
      UPLOAD_PAGE_TOKEN: 'page-secret',
    } as NodeJS.ProcessEnv);

    // The page's credential is refused by the gate that guards /mcp...
    expect(() =>
      authenticateStaticRequest({ authorization: 'Bearer page-secret' }, undefined, config)
    ).toThrow(AuthError);
    // ...and the MCP token is not what the page is handed.
    expect(getUploadPageToken({ MCP_AUTH_TOKENS: 'mcp-secret' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
