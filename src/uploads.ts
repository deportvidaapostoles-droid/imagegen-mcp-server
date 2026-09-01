/**
 * Image uploads.
 *
 * A remote MCP server cannot read the caller's filesystem, and passing a
 * multi-megabyte image inline through a tool call is unreliable — agents
 * truncate it. The way out is a URL: upload the bytes once, then hand the
 * tools a link. Storage is Vercel Blob, enabled by setting
 * BLOB_READ_WRITE_TOKEN (Vercel adds it automatically when a Blob store is
 * connected to the project).
 */

import { randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface UploadResult {
  url: string;
  size: number;
  contentType: string;
  /** Set when the store is private and the URL is a time-limited signed link. */
  expiresAt?: string;
}

export type BlobAccess = "public" | "private" | "auto";

/** How long a signed URL for a private store stays valid. */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

function accessPreference(env: NodeJS.ProcessEnv): BlobAccess {
  const raw = (env.BLOB_ACCESS ?? "").trim().toLowerCase();
  return raw === "public" || raw === "private" ? raw : "auto";
}

function signedUrlTtlSeconds(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.BLOB_URL_TTL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SIGNED_URL_TTL_SECONDS;
}

/** A Blob store created with private access refuses a public put; the message is how we learn. */
function isPrivateStoreError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /private access|configured with private access|public access on a private store/i.test(message);
}

export function isUploadConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

export function normalizeImageContentType(raw: string | undefined): string {
  const contentType = (raw || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`Only images can be uploaded (received content-type: ${contentType})`);
  }
  if (!(contentType in EXTENSIONS)) {
    throw new Error(
      `Unsupported image type '${contentType}'. Supported: ${Object.keys(EXTENSIONS).join(", ")}`
    );
  }
  return contentType;
}

/** Store an image and return a URL the image providers can fetch. */
export async function storeImage(
  body: Buffer,
  contentType: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): Promise<UploadResult> {
  if (!isUploadConfigured(env)) {
    throw new Error(
      "Uploads are not configured: create a Vercel Blob store for this project so BLOB_READ_WRITE_TOKEN is set"
    );
  }
  if (body.length === 0) {
    throw new Error("The uploaded file is empty");
  }
  if (body.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      `The file is too large (${Math.round(body.length / 1024 / 1024)} MB, limit ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`
    );
  }

  const normalized = normalizeImageContentType(contentType);
  const pathname = `imagegen/${randomUUID()}.${EXTENSIONS[normalized]}`;
  const preference = accessPreference(env);

  if (preference !== "private") {
    try {
      return await putPublic(pathname, body, normalized, env);
    } catch (error) {
      // A store created with private access cannot take a public blob. Rather
      // than making the operator recreate the store, sign a temporary URL.
      if (preference === "public" || !isPrivateStoreError(error)) throw error;
    }
  }

  return putPrivate(pathname, body, normalized, env);
}

async function putPublic(
  pathname: string,
  body: Buffer,
  contentType: string,
  env: NodeJS.ProcessEnv
): Promise<UploadResult> {
  const { put } = await import("@vercel/blob");
  const blob = await put(pathname, body, {
    access: "public",
    contentType,
    token: env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  });
  return { url: blob.url, size: body.length, contentType };
}

async function putPrivate(
  pathname: string,
  body: Buffer,
  contentType: string,
  env: NodeJS.ProcessEnv
): Promise<UploadResult> {
  const { put, issueSignedToken, presignUrl } = await import("@vercel/blob");
  const token = env.BLOB_READ_WRITE_TOKEN;

  const blob = await put(pathname, body, {
    access: "private",
    contentType,
    token,
    addRandomSuffix: false,
  });

  // The image provider fetches the URL itself and carries no credentials, so a
  // private blob has to be handed out as a signed, expiring link.
  const validUntil = Date.now() + signedUrlTtlSeconds(env) * 1000;
  const signed = await issueSignedToken({
    token,
    pathname: blob.pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signed, {
    operation: "get",
    pathname: blob.pathname,
    access: "private",
    validUntil,
  });

  return {
    url: presignedUrl,
    size: body.length,
    contentType,
    expiresAt: new Date(validUntil).toISOString(),
  };
}

/**
 * Read an image back out of this deployment's own Blob store.
 *
 * The image providers never fetch the URL themselves — this server does, then
 * inlines the bytes — so a blob in a private store is best read with the store
 * token rather than a signed link, which can expire or be mangled in transit.
 * Returns null when the URL belongs to someone else's host, leaving the caller
 * to fetch it as an ordinary public image.
 */
export async function readStoredImage(
  url: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ data: string; mimeType: string } | null> {
  if (!isUploadConfigured(env)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) return null;

  const access = parsed.hostname.includes(".private.") ? "private" : "public";
  // The signature lives in the query string; the token authenticates us instead.
  const canonical = `${parsed.origin}${parsed.pathname}`;

  const { get } = await import("@vercel/blob");
  const result = await get(canonical, { access, token: env.BLOB_READ_WRITE_TOKEN });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`The stored image is no longer available: ${parsed.pathname}`);
  }

  const chunks: Buffer[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }

  const body = Buffer.concat(chunks);
  const mimeType = (result.headers.get("content-type") || "image/png").split(";")[0].trim();
  return { data: body.toString("base64"), mimeType };
}
