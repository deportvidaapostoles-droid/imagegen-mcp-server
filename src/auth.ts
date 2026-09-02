/**
 * OAuth 2.1 bearer-token authentication for the remote (HTTP) transport.
 *
 * The server acts as an OAuth *resource server* only: it never issues tokens.
 * An external identity provider (Auth0, WorkOS, Okta, Entra ID, … — any OIDC
 * provider that issues JWT access tokens) authenticates the user, and this
 * module verifies the resulting JWT against the provider's JWKS, checks that the
 * token was minted for this resource, and finally checks the caller against an
 * allow-list of people who may use the server.
 *
 * Discovery follows RFC 9728 (Protected Resource Metadata): unauthenticated
 * requests get a 401 with a `WWW-Authenticate` header pointing at
 * `/.well-known/oauth-protected-resource`, which tells the MCP client which
 * authorization server to use.
 *
 * Configuration is environment-only — it is a deployment concern, not a CLI one.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";

export type AuthMode = "none" | "token" | "oauth";

export interface AuthConfig {
  mode: AuthMode;
  /** Shared secrets accepted in `token` mode (one per person, so they can be revoked individually). */
  tokens: string[];
  issuer?: string;
  /** Resource identifier the access token must be audience-bound to (RFC 8707). */
  audience?: string;
  jwksUri?: string;
  /** Claim carrying the user's email in the access token. */
  emailClaim: string;
  allowedEmails: string[];
  allowedEmailDomains: string[];
  allowedSubjects: string[];
  requiredScopes: string[];
  /** Canonical public URL of this deployment, when it cannot be derived from the request. */
  publicUrl?: string;
  /** Fatal misconfiguration: the server must refuse every request. */
  configError?: string;
  warnings: string[];
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    /** RFC 6750 error code, omitted for a bare challenge. */
    readonly code: string | undefined,
    readonly description: string
  ) {
    super(description);
    this.name = "AuthError";
  }
}

const DEFAULT_EMAIL_CLAIM = "email";

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const warnings: string[] = [];
  const rawMode = (env.MCP_AUTH_MODE ?? "none").trim().toLowerCase();

  const issuer = env.MCP_OAUTH_ISSUER?.trim();
  const audience = env.MCP_OAUTH_AUDIENCE?.trim();

  const tokens = splitList(env.MCP_AUTH_TOKENS);

  let mode: AuthMode;
  if (rawMode === "oauth") {
    mode = "oauth";
  } else if (rawMode === "token") {
    mode = "token";
  } else if (rawMode === "none" || rawMode === "") {
    mode = "none";
    if (issuer) {
      warnings.push(
        "MCP_OAUTH_ISSUER is set but MCP_AUTH_MODE is not 'oauth' — the endpoint is UNAUTHENTICATED"
      );
    }
    if (tokens.length > 0) {
      warnings.push(
        "MCP_AUTH_TOKENS is set but MCP_AUTH_MODE is not 'token' — the endpoint is UNAUTHENTICATED"
      );
    }
  } else {
    mode = "none";
    warnings.push(`Invalid MCP_AUTH_MODE '${rawMode}', falling back to 'none' (no authentication)`);
  }

  const allowedEmails = splitList(env.MCP_ALLOWED_EMAILS).map((item) => item.toLowerCase());
  const allowedEmailDomains = splitList(env.MCP_ALLOWED_EMAIL_DOMAINS).map((item) =>
    item.toLowerCase().replace(/^@/, "")
  );
  const allowedSubjects = splitList(env.MCP_ALLOWED_SUBJECTS);

  // Fail closed: an OAuth deployment missing its issuer or audience must not
  // silently degrade into an open endpoint.
  let configError: string | undefined;
  if (mode === "token" && tokens.length === 0) {
    configError = "MCP_AUTH_MODE=token requires MCP_AUTH_TOKENS";
  }
  if (mode === "oauth") {
    if (!issuer) {
      configError = "MCP_AUTH_MODE=oauth requires MCP_OAUTH_ISSUER";
    } else if (!audience) {
      configError = "MCP_AUTH_MODE=oauth requires MCP_OAUTH_AUDIENCE (the resource identifier)";
    } else if (
      allowedEmails.length === 0 &&
      allowedEmailDomains.length === 0 &&
      allowedSubjects.length === 0
    ) {
      warnings.push(
        "No allow-list configured (MCP_ALLOWED_EMAILS / MCP_ALLOWED_EMAIL_DOMAINS / " +
          "MCP_ALLOWED_SUBJECTS): every user of the identity provider may use this server"
      );
    }
  }

  return {
    mode,
    tokens,
    issuer: issuer ? trimTrailingSlash(issuer) : undefined,
    audience,
    jwksUri: env.MCP_OAUTH_JWKS_URI?.trim() || undefined,
    emailClaim: env.MCP_EMAIL_CLAIM?.trim() || DEFAULT_EMAIL_CLAIM,
    allowedEmails,
    allowedEmailDomains,
    allowedSubjects,
    requiredScopes: splitList(env.MCP_REQUIRED_SCOPES),
    publicUrl: env.MCP_PUBLIC_URL?.trim() ? trimTrailingSlash(env.MCP_PUBLIC_URL.trim()) : undefined,
    configError,
    warnings,
  };
}

export function isAuthEnabled(config: AuthConfig): boolean {
  return config.mode !== "none";
}

/** True when the mode advertises an OAuth authorization server. */
export function isOAuthMode(config: AuthConfig): boolean {
  return config.mode === "oauth";
}

// ─── Shared-secret mode ─────────────────────────────────────────────────────

function secretsMatch(a: string, b: string): boolean {
  // Digest first so the comparison is constant time regardless of length.
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/**
 * Read the shared secret of a request.
 * Accepted, in order: the `Authorization: Bearer` header, a `token`/`key` query
 * parameter, or the last path segment (`/mcp/<secret>`) — the only option for
 * clients that cannot send custom headers.
 */
/**
 * A credential that authorizes uploads and nothing else.
 *
 * The upload page is opened by shop staff on their phones, and asking them to
 * paste a secret is the one step they reliably get wrong. Setting
 * UPLOAD_PAGE_TOKEN lets the page carry its own credential — but the page is
 * public, so whatever it carries is public too. Keeping this separate from
 * MCP_AUTH_TOKENS is what stops that from also handing out the MCP server:
 * this token is accepted by /api/upload and by nothing else.
 */
export function getUploadPageToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = (env.UPLOAD_PAGE_TOKEN ?? "").trim();
  return token.length > 0 ? token : undefined;
}

/** True when the request presents the upload-only credential. */
export function matchesUploadPageToken(
  headers: IncomingHttpHeaders,
  url: URL | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = getUploadPageToken(env);
  if (!expected) return false;
  const presented = extractStaticSecret(headers, url);
  return Boolean(presented && secretsMatch(expected, presented));
}

export function extractStaticSecret(
  headers: IncomingHttpHeaders,
  url: URL | undefined,
  basePaths: string[] = ["/mcp", "/api/mcp"]
): string | undefined {
  const bearer = extractBearerToken(headers);
  if (bearer) return bearer;

  const fromQuery = url?.searchParams.get("token") ?? url?.searchParams.get("key");
  if (fromQuery) return fromQuery;

  if (url) {
    const path = url.pathname.replace(/\/+$/, "");
    for (const base of basePaths) {
      if (path.startsWith(`${base}/`)) {
        const candidate = path.slice(base.length + 1);
        if (candidate && !candidate.includes("/")) return decodeURIComponent(candidate);
      }
    }
  }

  return undefined;
}

/** Verify a request in `token` mode. Throws `AuthError` when it must be rejected. */
export function authenticateStaticRequest(
  headers: IncomingHttpHeaders,
  url: URL | undefined,
  config: AuthConfig
): AuthInfo {
  if (config.configError) {
    throw new AuthError(500, undefined, `Server authentication is misconfigured: ${config.configError}`);
  }

  const secret = extractStaticSecret(headers, url);
  if (!secret) {
    throw new AuthError(401, undefined, "Authentication required");
  }

  const index = config.tokens.findIndex((candidate) => secretsMatch(candidate, secret));
  if (index < 0) {
    throw new AuthError(401, "invalid_token", "Invalid access token");
  }

  return { token: secret, clientId: `static-token-${index + 1}`, scopes: [] };
}

// ─── Discovery ──────────────────────────────────────────────────────────────

interface DiscoveryDocument {
  jwks_uri?: string;
  [key: string]: unknown;
}

const discoveryCache = new Map<string, Promise<DiscoveryDocument>>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Fetch (and cache per warm instance) the identity provider's discovery document. */
export async function fetchDiscoveryDocument(issuer: string): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const pending = (async () => {
    const candidates = [
      `${issuer}/.well-known/openid-configuration`,
      `${issuer}/.well-known/oauth-authorization-server`,
    ];
    let lastError = "";
    for (const url of candidates) {
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        if (response.ok) return (await response.json()) as DiscoveryDocument;
        lastError = `${url} -> HTTP ${response.status}`;
      } catch (error) {
        lastError = `${url} -> ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    throw new Error(`Unable to discover authorization server metadata (${lastError})`);
  })();

  discoveryCache.set(issuer, pending);
  pending.catch(() => discoveryCache.delete(issuer));
  return pending;
}

async function getJwks(config: AuthConfig) {
  const issuer = config.issuer!;
  const jwksUri = config.jwksUri ?? (await fetchDiscoveryDocument(issuer)).jwks_uri;
  if (!jwksUri) {
    throw new Error("The authorization server metadata does not expose a jwks_uri");
  }
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}

// ─── Verification ───────────────────────────────────────────────────────────

export function extractBearerToken(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : undefined;
}

function collectScopes(payload: JWTPayload): string[] {
  const scope = payload.scope ?? (payload as Record<string, unknown>).scp;
  if (typeof scope === "string") return scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(scope)) return scope.filter((item): item is string => typeof item === "string");
  return [];
}

function readEmail(payload: JWTPayload, claim: string): string | undefined {
  const direct = payload[claim];
  if (typeof direct === "string") return direct;
  // Providers that namespace custom claims (Auth0 Actions, for instance) expose
  // the email under a URI-shaped claim; accept any claim whose name ends in the
  // configured one.
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && (key === claim || key.endsWith(`/${claim}`))) {
      return value;
    }
  }
  return undefined;
}

function isAllowed(config: AuthConfig, payload: JWTPayload): boolean {
  const hasAllowList =
    config.allowedEmails.length > 0 ||
    config.allowedEmailDomains.length > 0 ||
    config.allowedSubjects.length > 0;
  if (!hasAllowList) return true;

  const subject = typeof payload.sub === "string" ? payload.sub : undefined;
  if (subject && config.allowedSubjects.includes(subject)) return true;

  const email = readEmail(payload, config.emailClaim)?.toLowerCase();
  if (!email) return false;
  // Only trust an email the provider states it verified (when it says anything).
  if (payload.email_verified === false) return false;

  if (config.allowedEmails.includes(email)) return true;

  const domain = email.split("@")[1];
  return domain ? config.allowedEmailDomains.includes(domain) : false;
}

/**
 * Verify the bearer token of a request.
 * Throws `AuthError` when the caller must be rejected; returns the token info
 * to attach to the request otherwise.
 */
export async function authenticateRequest(
  headers: IncomingHttpHeaders,
  config: AuthConfig
): Promise<AuthInfo> {
  if (config.configError) {
    throw new AuthError(500, undefined, `Server authentication is misconfigured: ${config.configError}`);
  }

  const token = extractBearerToken(headers);
  if (!token) {
    throw new AuthError(401, undefined, "Authentication required");
  }

  let payload: JWTPayload;
  try {
    const jwks = await getJwks(config);
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
    }));
  } catch (error) {
    // A token we cannot even decode is malformed; anything else failed a check.
    let reason = error instanceof Error ? error.message : String(error);
    try {
      decodeJwt(token);
    } catch {
      reason = "The access token is not a JWT";
    }
    throw new AuthError(401, "invalid_token", reason);
  }

  const scopes = collectScopes(payload);
  const missingScopes = config.requiredScopes.filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new AuthError(
      403,
      "insufficient_scope",
      `The access token is missing required scope(s): ${missingScopes.join(", ")}`
    );
  }

  if (!isAllowed(config, payload)) {
    throw new AuthError(
      403,
      "insufficient_scope",
      "This account is not allowed to use this server"
    );
  }

  return {
    token,
    clientId: typeof payload.client_id === "string" ? payload.client_id : (payload.azp as string) ?? "",
    scopes,
    ...(typeof payload.exp === "number" ? { expiresAt: payload.exp } : {}),
    ...(config.audience ? { resource: new URL(config.audience) } : {}),
    extra: {
      subject: payload.sub,
      email: readEmail(payload, config.emailClaim),
    },
  };
}

// ─── Challenge & metadata documents ─────────────────────────────────────────

/** RFC 9728 §5.1 — the `WWW-Authenticate` challenge pointing at the metadata. */
export function buildChallenge(resourceMetadataUrl: string, error?: AuthError): string {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl}"`];
  if (error?.code) {
    parts.push(`error="${error.code}"`);
    parts.push(`error_description="${error.description.replace(/"/g, "'")}"`);
  }
  return parts.join(", ");
}

export function protectedResourceMetadataUrl(baseUrl: string, resourcePath = "/mcp"): string {
  // RFC 9728 §3.1: the resource path is appended to the well-known path.
  const suffix = resourcePath === "/" ? "" : resourcePath;
  return `${trimTrailingSlash(baseUrl)}/.well-known/oauth-protected-resource${suffix}`;
}

export function protectedResourceMetadata(
  config: AuthConfig,
  baseUrl: string
): Record<string, unknown> {
  return {
    resource: config.audience ?? `${trimTrailingSlash(baseUrl)}/mcp`,
    ...(config.issuer ? { authorization_servers: [config.issuer] } : {}),
    bearer_methods_supported: ["header"],
    ...(config.requiredScopes.length > 0 ? { scopes_supported: config.requiredScopes } : {}),
    resource_documentation: `${trimTrailingSlash(baseUrl)}/`,
  };
}
