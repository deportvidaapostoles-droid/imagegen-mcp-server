/**
 * HTTP transport layer for the MCP server (Streamable HTTP).
 *
 * Implements the stateless variant of the MCP Streamable HTTP transport: a new
 * `Server` + `StreamableHTTPServerTransport` pair is created for every request
 * and disposed when the response closes. This is the model required by
 * serverless runtimes (Vercel), where no state can be shared between
 * invocations, and it works equally well for a long-lived local process.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ServerRuntimeConfig } from "./config.js";
import {
  AuthError,
  authenticateRequest,
  authenticateStaticRequest,
  buildChallenge,
  fetchDiscoveryDocument,
  isAuthEnabled,
  isOAuthMode,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  type AuthConfig,
} from "./auth.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./mcp-server.js";

/** Node request as seen by both `node:http` and the Vercel Node runtime. */
export type NodeRequest = IncomingMessage & { body?: unknown };

const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Accept",
  "Last-Event-ID",
  "mcp-session-id",
  "mcp-protocol-version",
].join(", ");

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function applyCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0" as const, error: { code, message }, id: null };
}

/**
 * Resolve the JSON body of a request.
 * Vercel parses `application/json` bodies ahead of time; a plain `node:http`
 * server does not, so fall back to reading the stream.
 */
export async function readJsonBody(req: NodeRequest): Promise<unknown> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") {
      return req.body.length === 0 ? undefined : JSON.parse(req.body);
    }
    if (Buffer.isBuffer(req.body)) {
      return req.body.length === 0 ? undefined : JSON.parse(req.body.toString("utf8"));
    }
    return req.body;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

/** Read a request body as raw bytes, up to `limit`. */
export async function readRawBody(req: NodeRequest, limit: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > limit) {
      throw new Error(`Request body too large (limit ${Math.round(limit / 1024 / 1024)} MB)`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export interface McpHttpHandlerOptions {
  log?: (...args: unknown[]) => void;
  /** When set to OAuth mode, every request must carry a valid bearer token. */
  auth?: AuthConfig;
}

/** Public origin of this deployment, as seen by the client. */
export function resolveBaseUrl(req: NodeRequest, authConfig?: AuthConfig): string {
  if (authConfig?.publicUrl) return authConfig.publicUrl;
  const forwardedProto = headerValue(req, "x-forwarded-proto")?.split(",")[0]?.trim();
  const host = headerValue(req, "x-forwarded-host") ?? headerValue(req, "host") ?? "localhost";
  const proto = forwardedProto ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

function headerValue(req: NodeRequest, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Authenticate a request against the configured mode, writing the rejection
 * response itself when the caller must be turned away. Shared by every
 * endpoint that must not be open to the world.
 */
export async function authorizeRequest(
  req: NodeRequest,
  res: ServerResponse,
  authConfig: AuthConfig | undefined,
  log: (...args: unknown[]) => void = () => {}
): Promise<{ ok: true; authInfo?: AuthInfo } | { ok: false }> {
  if (!authConfig || !isAuthEnabled(authConfig)) return { ok: true };

  const baseUrl = resolveBaseUrl(req, authConfig);
  try {
    const authInfo = isOAuthMode(authConfig)
      ? await authenticateRequest(req.headers, authConfig)
      : authenticateStaticRequest(req.headers, new URL(req.url ?? "/", baseUrl), authConfig);
    return { ok: true, authInfo };
  } catch (error) {
    const authError =
      error instanceof AuthError
        ? error
        : new AuthError(401, "invalid_token", error instanceof Error ? error.message : String(error));
    if (authError.status >= 500) {
      log("Authentication misconfigured:", authError.description);
    }
    // Only OAuth mode advertises a login: a `WWW-Authenticate` header in
    // shared-secret mode would send clients hunting for an authorization
    // server that does not exist.
    if (isOAuthMode(authConfig)) {
      const metadataUrl = protectedResourceMetadataUrl(baseUrl);
      if (authError.status === 401) {
        res.setHeader("WWW-Authenticate", buildChallenge(metadataUrl, authError));
      }
      writeJson(res, authError.status, {
        ...jsonRpcError(-32001, authError.description),
        error_uri: metadataUrl,
      });
    } else {
      writeJson(res, authError.status, jsonRpcError(-32001, authError.description));
    }
    return { ok: false };
  }
}

/**
 * Handle a single MCP request over Streamable HTTP (stateless mode).
 * Safe to call from a `node:http` server or from a Vercel serverless function.
 */
export async function handleMcpRequest(
  req: NodeRequest,
  res: ServerResponse,
  config: ServerRuntimeConfig,
  options: McpHttpHandlerOptions = {}
): Promise<void> {
  const log = options.log ?? (() => {});
  applyCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const authConfig = options.auth;
  const authorized = await authorizeRequest(req, res, authConfig, log);
  if (!authorized.ok) return;
  const authInfo = authorized.authInfo;

  // Stateless mode has no long-lived stream to resume and no session to delete.
  if (req.method === "GET" || req.method === "DELETE") {
    res.setHeader("Allow", "POST, OPTIONS");
    writeJson(
      res,
      405,
      jsonRpcError(-32000, "Method not allowed. This MCP endpoint is stateless: use POST.")
    );
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    writeJson(res, 405, jsonRpcError(-32000, "Method not allowed."));
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    writeJson(
      res,
      400,
      jsonRpcError(-32700, `Parse error: ${error instanceof Error ? error.message : String(error)}`)
    );
    return;
  }

  if (authInfo) {
    (req as NodeRequest & { auth?: unknown }).auth = authInfo;
  }

  // The instructions name the upload page, so the model can point the user at a
  // real link rather than describing an upload in the abstract.
  const origin = resolveBaseUrl(req, authConfig);
  const { server } = createMcpServer(config, {
    log,
    baseUrl: origin,
    uploadPageUrl: `${origin}/u`,
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const dispose = () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  };
  res.on("close", dispose);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    log("MCP request failed:", error);
    if (!res.headersSent) {
      writeJson(res, 500, jsonRpcError(-32603, "Internal server error"));
    } else {
      res.end();
    }
    dispose();
  }
}

/** Serve the RFC 9728 protected resource metadata document. */
export function handleProtectedResourceMetadata(
  req: NodeRequest,
  res: ServerResponse,
  authConfig: AuthConfig
): void {
  applyCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (!isOAuthMode(authConfig)) {
    // No authorization server to advertise: RFC 9728 clients read a 404 as
    // "this resource is not protected".
    writeJson(res, 404, { error: "not_found", error_description: "This server does not require authentication" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  writeJson(res, 200, protectedResourceMetadata(authConfig, resolveBaseUrl(req, authConfig)));
}

/**
 * Mirror the identity provider's authorization server metadata.
 * Clients predating RFC 9728 look for this document on the resource server
 * itself; serving it keeps them working.
 */
export async function handleAuthorizationServerMetadata(
  req: NodeRequest,
  res: ServerResponse,
  authConfig: AuthConfig
): Promise<void> {
  applyCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (!isOAuthMode(authConfig) || !authConfig.issuer) {
    writeJson(res, 404, { error: "not_found", error_description: "This server does not require authentication" });
    return;
  }
  try {
    const document = await fetchDiscoveryDocument(authConfig.issuer);
    res.setHeader("Cache-Control", "public, max-age=3600");
    writeJson(res, 200, document);
  } catch (error) {
    writeJson(res, 502, {
      error: "server_error",
      error_description: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Payload served by the health endpoint. */
export function healthPayload(
  config?: ServerRuntimeConfig,
  authConfig?: AuthConfig
): Record<string, unknown> {
  return {
    status: "ok",
    service: SERVER_NAME,
    version: SERVER_VERSION,
    transport: "streamable-http",
    ...(config
      ? {
          provider: config.provider,
          model: config.model,
          configured: Boolean(
            config.provider === "openai" ? config.openaiApiKey : config.geminiApiKey
          ),
        }
      : {}),
    ...(authConfig
      ? {
          auth: authConfig.configError ? "misconfigured" : isAuthEnabled(authConfig) ? authConfig.mode : "disabled",
        }
      : {}),
    timestamp: new Date().toISOString(),
  };
}
