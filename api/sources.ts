/**
 * Vercel serverless function — the places photos can be filed under.
 *
 * Public route: GET https://<deployment>/api/sources
 *
 * The upload page needs the same list the `recent_uploads` tool offers, so both
 * read it from UPLOAD_SOURCES rather than each keeping its own copy, plus the
 * upload-only credential that saves shop staff from ever seeing a token.
 *
 * This route is unauthenticated by necessity: the page has to configure itself
 * before anyone could have authenticated. `uploadToken` is therefore public --
 * that is exactly why it is UPLOAD_PAGE_TOKEN and never MCP_AUTH_TOKENS. It
 * lets a stranger who finds this deployment store images, and nothing else.
 */

import type { ServerResponse } from "node:http";
import { loadDotEnv } from "../src/config.js";
import { applyCorsHeaders, writeJson, type NodeRequest } from "../src/http-transport.js";
import { getUploadPageToken } from "../src/auth.js";
import { getUploadSources } from "../src/uploads.js";

loadDotEnv();

export default function handler(req: NodeRequest, res: ServerResponse): void {
  applyCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    writeJson(res, 405, { error: "method_not_allowed", error_description: "Use GET." });
    return;
  }

  writeJson(res, 200, {
    sources: getUploadSources().map((source) => source.label),
    uploadToken: getUploadPageToken() ?? null,
  });
}
