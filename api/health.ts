/**
 * Vercel serverless function — health check.
 *
 * Public routes: GET https://<deployment>/api/health and /health
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getAuthConfig } from "../src/auth.js";
import { getServerRuntimeConfig, loadDotEnv } from "../src/config.js";
import { applyCorsHeaders, healthPayload, writeJson } from "../src/http-transport.js";

loadDotEnv();

const runtimeConfig = getServerRuntimeConfig([], process.env);
const authConfig = getAuthConfig(process.env);

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  applyCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  writeJson(res, 200, healthPayload(runtimeConfig, authConfig));
}
