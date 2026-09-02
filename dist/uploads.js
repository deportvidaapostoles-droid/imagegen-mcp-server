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
/** Every image this server stores lives under one prefix, so it can list its own. */
const PREFIX = "imagegen/";
const EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};
/** How long a signed URL for a private store stays valid. */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;
function accessPreference(env) {
    const raw = (env.BLOB_ACCESS ?? "").trim().toLowerCase();
    return raw === "public" || raw === "private" ? raw : "auto";
}
function signedUrlTtlSeconds(env) {
    const parsed = Number.parseInt(env.BLOB_URL_TTL_SECONDS ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SIGNED_URL_TTL_SECONDS;
}
/** A Blob store created with private access refuses a public put; the message is how we learn. */
function isPrivateStoreError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /private access|configured with private access|public access on a private store/i.test(message);
}
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
/** Store an image and return a URL the image providers can fetch. */
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
    const pathname = `${PREFIX}${randomUUID()}.${EXTENSIONS[normalized]}`;
    const preference = accessPreference(env);
    if (preference !== "private") {
        try {
            return await putPublic(pathname, body, normalized, env);
        }
        catch (error) {
            // A store created with private access cannot take a public blob. Rather
            // than making the operator recreate the store, sign a temporary URL.
            if (preference === "public" || !isPrivateStoreError(error))
                throw error;
        }
    }
    return putPrivate(pathname, body, normalized, env);
}
async function putPublic(pathname, body, contentType, env) {
    const { put } = await import("@vercel/blob");
    const blob = await put(pathname, body, {
        access: "public",
        contentType,
        token: env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
    });
    return { url: blob.url, size: body.length, contentType };
}
async function putPrivate(pathname, body, contentType, env) {
    const { put } = await import("@vercel/blob");
    const token = env.BLOB_READ_WRITE_TOKEN;
    const blob = await put(pathname, body, {
        access: "private",
        contentType,
        token,
        addRandomSuffix: false,
    });
    const link = await signGetUrl(blob.pathname, env);
    return { url: link.url, size: body.length, contentType, expiresAt: link.expiresAt };
}
/**
 * A private blob has to be handed out as a signed, expiring link: the image
 * provider fetches the URL itself and carries no credentials.
 */
async function signGetUrl(pathname, env) {
    const { issueSignedToken, presignUrl } = await import("@vercel/blob");
    const token = env.BLOB_READ_WRITE_TOKEN;
    const validUntil = Date.now() + signedUrlTtlSeconds(env) * 1000;
    const signed = await issueSignedToken({ token, pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(signed, {
        operation: "get",
        pathname,
        access: "private",
        validUntil,
    });
    return { url: presignedUrl, expiresAt: new Date(validUntil).toISOString() };
}
/**
 * The images most recently added to this store, newest first.
 *
 * This is what lets an upload made in a browser reach the model without the
 * user copying a URL across: they drop the photo, then say so, and the tool
 * finds it. Pathnames are random UUIDs, so the store cannot return them in
 * upload order — a page is fetched and sorted here, which is exact for the
 * first 1000 images and approximate beyond that.
 */
export async function listRecentImages(limit = 5, env = process.env) {
    if (!isUploadConfigured(env)) {
        throw new Error("Uploads are not configured: create a Vercel Blob store for this project so BLOB_READ_WRITE_TOKEN is set");
    }
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: PREFIX, limit: 1000, token: env.BLOB_READ_WRITE_TOKEN });
    const newest = [...blobs]
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
        .slice(0, Math.max(1, limit));
    return Promise.all(newest.map(async (blob) => {
        const summary = {
            url: blob.url,
            pathname: blob.pathname,
            size: blob.size,
            uploadedAt: new Date(blob.uploadedAt).toISOString(),
        };
        if (!new URL(blob.url).hostname.includes(".private."))
            return summary;
        const link = await signGetUrl(blob.pathname, env);
        return { ...summary, url: link.url, expiresAt: link.expiresAt };
    }));
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
export async function readStoredImage(url, env = process.env) {
    if (!isUploadConfigured(env))
        return null;
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return null;
    }
    if (!parsed.hostname.endsWith(".blob.vercel-storage.com"))
        return null;
    const access = parsed.hostname.includes(".private.") ? "private" : "public";
    // The signature lives in the query string; the token authenticates us instead.
    const canonical = `${parsed.origin}${parsed.pathname}`;
    const { get } = await import("@vercel/blob");
    const result = await get(canonical, { access, token: env.BLOB_READ_WRITE_TOKEN });
    if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error(`The stored image is no longer available: ${parsed.pathname}`);
    }
    const chunks = [];
    const reader = result.stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value)
            chunks.push(Buffer.from(value));
    }
    const body = Buffer.concat(chunks);
    const mimeType = (result.headers.get("content-type") || "image/png").split(";")[0].trim();
    return { data: body.toString("base64"), mimeType };
}
//# sourceMappingURL=uploads.js.map