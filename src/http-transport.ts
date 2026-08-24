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
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ServerRuntimeConfig } from "./config.js";
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

export interface McpHttpHandlerOptions {
  log?: (...args: unknown[]) => void;
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

  const { server } = createMcpServer(config, { log });
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

/** Payload served by the health endpoint. */
export function healthPayload(config?: ServerRuntimeConfig): Record<string, unknown> {
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
    timestamp: new Date().toISOString(),
  };
}
