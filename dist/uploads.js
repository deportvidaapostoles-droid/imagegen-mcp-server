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
function slug(label) {
    return label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/**
 * The places photos come from — two shops sharing one deployment, say.
 *
 * Configured as UPLOAD_SOURCES="Farmacia Paula, De Por Vida". Left unset, the
 * server keeps its original single-bucket behaviour and never asks anyone to
 * choose, so this stays invisible to deployments that do not need it.
 */
export function getUploadSources(env = process.env) {
    const seen = new Set();
    return (env.UPLOAD_SOURCES ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .flatMap((label) => {
        const id = slug(label);
        if (!id || seen.has(id))
            return [];
        seen.add(id);
        return [{ id, label }];
    });
}
/**
 * Match what the caller said against the configured sources, by id or by label.
 * People type "De Por Vida"; the upload page sends "de-por-vida"; both resolve.
 */
export function resolveUploadSource(requested, env = process.env) {
    const sources = getUploadSources(env);
    if (sources.length === 0)
        return undefined;
    const wanted = (requested ?? "").trim();
    if (!wanted) {
        throw new Error(`Say which one this photo is for: ${sources.map((source) => source.label).join(", ")}`);
    }
    const key = slug(wanted);
    const match = sources.find((source) => source.id === key);
    if (!match) {
        throw new Error(`Unknown source '${wanted}'. Configured: ${sources.map((source) => source.label).join(", ")}`);
    }
    return match;
}
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
export async function storeImage(body, contentType, env = process.env, requestedSource) {
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
    const source = resolveUploadSource(requestedSource, env);
    const folder = source ? `${source.id}/` : "";
    const pathname = `${PREFIX}${folder}${randomUUID()}.${EXTENSIONS[normalized]}`;
    const preference = accessPreference(env);
    const stored = await (async () => {
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
    })();
    return source ? { ...stored, source: source.label } : stored;
}
async function putPublic(pathname, body, contentType, env) {
    const { put } = await import("@vercel/blob");
    const blob = await put(pathname, body, {
        access: "public",
        contentType,
        token: env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
    });
    return { url: blob.url, pathname: blob.pathname, size: body.length, contentType };
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
    return {
        url: link.url,
        pathname: blob.pathname,
        size: body.length,
        contentType,
        expiresAt: link.expiresAt,
    };
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
export async function listRecentImages(limit = 5, env = process.env, requestedSource) {
    if (!isUploadConfigured(env)) {
        throw new Error("Uploads are not configured: create a Vercel Blob store for this project so BLOB_READ_WRITE_TOKEN is set");
    }
    // Filtering by source is just a narrower prefix — the store does the work.
    const sources = getUploadSources(env);
    const only = requestedSource ? resolveUploadSource(requestedSource, env) : undefined;
    const prefix = only ? `${PREFIX}${only.id}/` : PREFIX;
    const labelById = new Map(sources.map((source) => [source.id, source.label]));
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix, limit: 1000, token: env.BLOB_READ_WRITE_TOKEN });
    const newest = [...blobs]
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
        .slice(0, Math.max(1, limit));
    return Promise.all(newest.map(async (blob) => {
        const folder = blob.pathname.slice(PREFIX.length).split("/")[0];
        const summary = {
            url: blob.url,
            pathname: blob.pathname,
            size: blob.size,
            uploadedAt: new Date(blob.uploadedAt).toISOString(),
            ...(labelById.has(folder) ? { source: labelById.get(folder) } : {}),
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
/**
 * The path segment under which this server re-serves its own stored images.
 *
 * A private store can only hand out signed links, which lapse — fine for one
 * edit, useless for a link someone keeps. Serving the bytes ourselves gives a
 * URL that never expires, at the cost of making the object readable by anyone
 * holding the link. That is the same exposure a public store would give, and
 * the pathname is a random UUID, so it is not guessable.
 */
export const IMAGE_ROUTE = "/i/";
export function stableImageUrl(baseUrl, pathname) {
    if (!baseUrl)
        return undefined;
    return `${baseUrl.replace(/\/+$/, "")}${IMAGE_ROUTE}${pathname.split("/").map(encodeURIComponent).join("/")}`;
}
/** Read one of this store's own images by its pathname, for re-serving. */
export async function openStoredImage(pathname, env = process.env) {
    if (!isUploadConfigured(env))
        return null;
    // Only ever serve what this server itself stored.
    if (!pathname.startsWith(PREFIX) || pathname.includes(".."))
        return null;
    const { head, get } = await import("@vercel/blob");
    const token = env.BLOB_READ_WRITE_TOKEN;
    let url;
    try {
        url = (await head(pathname, { token })).url;
    }
    catch {
        return null;
    }
    const access = new URL(url).hostname.includes(".private.") ? "private" : "public";
    const result = await get(`${new URL(url).origin}${new URL(url).pathname}`, { access, token });
    if (!result || result.statusCode !== 200 || !result.stream)
        return null;
    const chunks = [];
    const reader = result.stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value)
            chunks.push(Buffer.from(value));
    }
    return {
        body: Buffer.concat(chunks),
        contentType: (result.headers.get("content-type") || "image/png").split(";")[0].trim(),
    };
}
//# sourceMappingURL=uploads.js.map