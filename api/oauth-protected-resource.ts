/**
 * Vercel serverless function — OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Public routes (rewritten in vercel.json):
 *   GET /.well-known/oauth-protected-resource
 *   GET /.well-known/oauth-protected-resource/mcp
 *
 * MCP clients read this document — pointed to by the `WWW-Authenticate` header
 * of a 401 — to learn which authorization server to authenticate against.
 */

import type { ServerResponse } from "node:http";
import { getAuthConfig } from "../src/auth.js";
import { loadDotEnv } from "../src/config.js";
import { handleProtectedResourceMetadata, type NodeRequest } from "../src/http-transport.js";

loadDotEnv();

const authConfig = getAuthConfig(process.env);

export default function handler(req: NodeRequest, res: ServerResponse): void {
  handleProtectedResourceMetadata(req, res, authConfig);
}
