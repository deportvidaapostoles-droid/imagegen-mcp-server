/**
 * Vercel serverless function — the places photos can be filed under.
 *
 * Public route: GET https://<deployment>/api/sources
 *
 * The upload page needs the same list the `recent_uploads` tool offers, so both
 * read it from UPLOAD_SOURCES rather than each keeping its own copy. This route
 * is deliberately unauthenticated: it returns only the labels an operator chose
 * to show on a page that is itself public, and the page must be able to render
 * its picker before anyone has typed a token.
 */

import type { ServerResponse } from "node:http";
import { loadDotEnv } from "../src/config.js";
import { applyCorsHeaders, writeJson, type NodeRequest } from "../src/http-transport.js";
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

  writeJson(res, 200, { sources: getUploadSources().map((source) => source.label) });
}
