/**
 * Vercel serverless function — re-serve a stored image at a permanent URL.
 *
 * Public route: GET https://<deployment>/i/imagegen/<place>/<id>.png
 *
 * A private Blob store can only hand out signed links, and those lapse after a
 * few hours — fine for one edit, useless for a link someone pins in a chat or
 * pastes into a scheduling tool. This route reads the object with the store
 * token and streams it, so the URL never changes and never expires.
 *
 * It is deliberately unauthenticated: an image the model must fetch, or a
 * person must open on their phone, cannot carry a bearer token. The pathname is
 * a random UUID, so this is the same exposure a public Blob store gives.
 */

import type { ServerResponse } from "node:http";
import { loadDotEnv } from "../src/config.js";
import { applyCorsHeaders, writeJson, type NodeRequest } from "../src/http-transport.js";
import { IMAGE_ROUTE, isUploadConfigured, openStoredImage } from "../src/uploads.js";

loadDotEnv();

export default async function handler(req: NodeRequest, res: ServerResponse): Promise<void> {
  applyCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    writeJson(res, 405, { error: "method_not_allowed", error_description: "Use GET." });
    return;
  }
  if (!isUploadConfigured()) {
    writeJson(res, 501, {
      error: "uploads_not_configured",
      error_description: "This deployment has no Blob store, so it has no images to serve.",
    });
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  // Vercel rewrites /i/<path> here; the path also arrives as ?path= when called directly.
  const raw = url.searchParams.get("path") ?? decodeURIComponent(url.pathname).slice(IMAGE_ROUTE.length);
  const pathname = raw.replace(/^\/+/, "");

  let image: Awaited<ReturnType<typeof openStoredImage>>;
  try {
    image = await openStoredImage(pathname);
  } catch (error) {
    writeJson(res, 502, {
      error: "image_unavailable",
      error_description: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!image) {
    writeJson(res, 404, {
      error: "not_found",
      error_description: `No stored image at ${pathname}.`,
    });
    return;
  }

  res.writeHead(200, {
    "content-type": image.contentType,
    "content-length": String(image.body.length),
    // The pathname carries a UUID, so a stored image never changes under its URL.
    "cache-control": "public, max-age=31536000, immutable",
  });
  res.end(req.method === "HEAD" ? undefined : image.body);
}
