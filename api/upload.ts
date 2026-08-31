/**
 * Vercel serverless function — image upload.
 *
 * Public route: POST https://<deployment>/api/upload
 *
 * A remote MCP server cannot read the caller's filesystem, and a
 * multi-megabyte base64 string does not survive a trip through an agent's
 * context. Uploading the image once and passing the returned URL to
 * `edit_image` / `submit_task` avoids both problems.
 *
 *   curl -X POST --data-binary @photo.png \
 *        -H 'content-type: image/png' \
 *        -H 'authorization: Bearer <MCP_AUTH_TOKENS value>' \
 *        https://<deployment>/api/upload
 */

import type { ServerResponse } from "node:http";
import { getAuthConfig } from "../src/auth.js";
import { loadDotEnv } from "../src/config.js";
import {
  applyCorsHeaders,
  authorizeRequest,
  readRawBody,
  writeJson,
  type NodeRequest,
} from "../src/http-transport.js";
import { MAX_UPLOAD_BYTES, isUploadConfigured, storeImage } from "../src/uploads.js";

loadDotEnv();

const authConfig = getAuthConfig(process.env);

export default async function handler(req: NodeRequest, res: ServerResponse): Promise<void> {
  applyCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    writeJson(res, 405, { error: "method_not_allowed", error_description: "Use POST to upload an image." });
    return;
  }

  const authorized = await authorizeRequest(req, res, authConfig, console.error);
  if (!authorized.ok) return;

  if (!isUploadConfigured()) {
    writeJson(res, 501, {
      error: "uploads_not_configured",
      error_description:
        "Create a Vercel Blob store for this project (Storage -> Create -> Blob) so BLOB_READ_WRITE_TOKEN is set.",
    });
    return;
  }

  try {
    const body = await readRawBody(req, MAX_UPLOAD_BYTES);
    const result = await storeImage(body, headerValue(req, "content-type"));
    writeJson(res, 201, {
      ...result,
      message: "Pass this url to the images parameter of edit_image or submit_task.",
    });
  } catch (error) {
    writeJson(res, 400, {
      error: "upload_failed",
      error_description: error instanceof Error ? error.message : String(error),
    });
  }
}

function headerValue(req: NodeRequest, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}
