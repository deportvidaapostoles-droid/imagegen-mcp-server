/**
 * Vercel serverless function — authorization server metadata mirror.
 *
 * Public route: GET /.well-known/oauth-authorization-server
 *
 * Clients predating RFC 9728 look for the authorization server document on the
 * MCP server itself instead of following the protected-resource metadata, so
 * this endpoint mirrors the identity provider's discovery document.
 */

import type { ServerResponse } from "node:http";
import { getAuthConfig } from "../src/auth.js";
import { loadDotEnv } from "../src/config.js";
import { handleAuthorizationServerMetadata, type NodeRequest } from "../src/http-transport.js";

loadDotEnv();

const authConfig = getAuthConfig(process.env);

export default async function handler(req: NodeRequest, res: ServerResponse): Promise<void> {
  await handleAuthorizationServerMetadata(req, res, authConfig);
}
