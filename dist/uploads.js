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
const EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};
export function isUploadConfigured(env = process.env) {
    return Boolean(env.BLOB_READ_WRITE_TOKEN);
}
export function normalizeImageContentType(raw) {
    const contentType = (raw || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
        throw new Error(`Only images can be uploaded (received content-type: ${contentType})`);
    }
    if (!(contentType in EXTENSIONS)) {
        throw new Error(`Unsupported image type '${contentType}'. Supported: ${Object.keys(EXTENSIONS).join(", ")}`);
    }
    return contentType;
}
/** Store an image and return the public URL the image tools can read. */
export async function storeImage(body, contentType, env = process.env) {
    if (!isUploadConfigured(env)) {
        throw new Error("Uploads are not configured: create a Vercel Blob store for this project so BLOB_READ_WRITE_TOKEN is set");
    }
    if (body.length === 0) {
        throw new Error("The uploaded file is empty");
    }
    if (body.length > MAX_UPLOAD_BYTES) {
        throw new Error(`The file is too large (${Math.round(body.length / 1024 / 1024)} MB, limit ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
    }
    const normalized = normalizeImageContentType(contentType);
    const { put } = await import("@vercel/blob");
    const blob = await put(`imagegen/${randomUUID()}.${EXTENSIONS[normalized]}`, body, {
        access: "public",
        contentType: normalized,
        token: env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
    });
    return { url: blob.url, size: body.length, contentType: normalized };
}
//# sourceMappingURL=uploads.js.map