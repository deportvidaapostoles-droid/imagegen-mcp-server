/**
 * Vercel serverless function — MCP Streamable HTTP endpoint.
 *
 * Public route: POST https://<deployment>/mcp  (rewritten to /api/mcp)
 *
 * The MCP server is rebuilt per invocation (stateless transport), which is the
 * transport mode recommended for serverless runtimes: no session state is kept
 * between requests and every invocation is self-contained.
 */

import type { ServerResponse } from "node:http";
import { getAuthConfig } from "../src/auth.js";
import { getServerRuntimeConfig, loadDotEnv } from "../src/config.js";
import { handleMcpRequest, type NodeRequest } from "../src/http-transport.js";

loadDotEnv();

// Parsed once per cold start. CLI args are irrelevant in a serverless runtime,
// so the configuration comes exclusively from environment variables.
const runtimeConfig = getServerRuntimeConfig([], process.env);
const authConfig = getAuthConfig(process.env);

for (const warning of [...runtimeConfig.warnings, ...authConfig.warnings]) {
  console.warn(`Config warning: ${warning}`);
}

export default async function handler(req: NodeRequest, res: ServerResponse): Promise<void> {
  await handleMcpRequest(req, res, runtimeConfig, { log: console.error, auth: authConfig });
}
