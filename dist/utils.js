/**
 * Utility functions for the imagegen-mcp server
 */
/**
 * Convert an image URL to base64 encoded data
 */
/** Largest image accepted from a URL, to keep a bad link from exhausting memory. */
export const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;
/**
 * Rewrite a share link into something that actually serves bytes.
 *
 * People hand over the link their phone or laptop gave them, which for Drive
 * and Dropbox is a viewer page, not the file. Both providers have a direct
 * form, so translate rather than refuse — the file still has to be shared with
 * anyone who has the link, which `describeFetchFailure` explains when it is not.
 */
export function normalizeSharedImageUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return url;
    }
    if (parsed.hostname === 'drive.google.com') {
        // .../file/d/<id>/view  and  /open?id=<id>  both name a file we can download.
        const fileId = /\/file\/d\/([^/]+)/.exec(parsed.pathname)?.[1] ?? parsed.searchParams.get('id');
        if (fileId)
            return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
    }
    if (parsed.hostname.endsWith('dropbox.com') && parsed.searchParams.get('raw') !== '1') {
        parsed.searchParams.delete('dl');
        parsed.searchParams.set('raw', '1');
        return parsed.toString();
    }
    return url;
}
/** Turn "not an image" into the reason, which is usually a sharing setting. */
function describeFetchFailure(url, contentType) {
    const host = (() => {
        try {
            return new URL(url).hostname;
        }
        catch {
            return '';
        }
    })();
    if (host.endsWith('google.com') && contentType.startsWith('text/html')) {
        return ('Google returned a web page instead of the image. The file is probably not shared: open it in ' +
            "Drive, choose Share -> General access -> Anyone with the link, and pass the link again.");
    }
    if (host.endsWith('dropbox.com') && contentType.startsWith('text/html')) {
        return ('Dropbox returned a web page instead of the image. Make sure the link is a shared file link ' +
            'and that the file is still shared.');
    }
    if (host.endsWith('goo.gl') || host.endsWith('photos.google.com')) {
        return ('Google Photos album links do not serve the image itself, and there is no direct form to rewrite ' +
            'them to. Download the photo and upload it, or put it in a shared Drive folder instead.');
    }
    return `The URL does not point to an image (content-type: ${contentType})`;
}
export async function urlToBase64(rawUrl) {
    const url = normalizeSharedImageUrl(rawUrl);
    try {
        const response = await fetch(url, { headers: { accept: 'image/*' } });
        if (!response.ok) {
            throw new Error(`Failed to fetch image: HTTP ${response.status} ${response.statusText}`);
        }
        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (declaredLength > MAX_REMOTE_IMAGE_BYTES) {
            throw new Error(`Image is too large (${Math.round(declaredLength / 1024 / 1024)} MB, limit ${MAX_REMOTE_IMAGE_BYTES / 1024 / 1024} MB)`);
        }
        const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim();
        if (!contentType.startsWith('image/')) {
            throw new Error(describeFetchFailure(url, contentType));
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
            throw new Error(`Image is too large (limit ${MAX_REMOTE_IMAGE_BYTES / 1024 / 1024} MB)`);
        }
        return { data: buffer.toString('base64'), mimeType: contentType };
    }
    catch (error) {
        throw new Error(`Failed to fetch image from URL: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Normalize OpenAI-compatible image responses into base64 image data.
 * Always returns base64 data — URLs are fetched and converted.
 */
export async function openAIImageToBase64(image) {
    if (image.b64_json) {
        return { data: image.b64_json, mimeType: 'image/png' };
    }
    if (image.url) {
        return urlToBase64(image.url);
    }
    return null;
}
/** True when this process is a serverless deployment with no access to the caller's disk. */
export function isRemoteDeployment(env = process.env) {
    return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.MCP_REMOTE_DEPLOYMENT);
}
/**
 * A file path is meaningless to a remote server, and an agent that is handed a
 * bare ENOENT tends to retry the same path. Say what to do instead.
 */
export const REMOTE_FILE_PATH_HELP = 'This server runs remotely and cannot read files on your machine. ' +
    'Upload the image (POST it to /api/upload, or use the /upload.html page) and pass the returned https:// URL ' +
    'in the images parameter instead. A base64-encoded string also works for small images.';
/**
 * Parse an image input that can be:
 * - A file path (absolute path starting with /)
 * - A data URL (data:image/xxx;base64,...)
 * - A raw base64 string
 * Returns { data: base64, mimeType: string }
 */
export async function parseImageInput(input) {
    // Data URL
    if (input.startsWith('data:image/')) {
        const match = input.match(/^data:(image\/\w+);base64,(.*)$/);
        if (match) {
            return { data: match[2], mimeType: match[1] };
        }
        throw new Error('Invalid data URL format');
    }
    // HTTP(S) URL — the only practical way to hand a large image to a *remote*
    // MCP server: the file lives on the client's machine, the server does not
    // share its filesystem, and inlining megabytes of base64 through the tool
    // call is unreliable (it gets truncated on the way).
    if (input.startsWith('http://') || input.startsWith('https://')) {
        // An image this deployment stored itself is read with the store token: a
        // signed link can expire or lose a query parameter on the way here.
        const { readStoredImage } = await import('./uploads.js');
        const stored = await readStoredImage(input);
        if (stored)
            return stored;
        return urlToBase64(input);
    }
    // File path — only meaningful when the server runs on the same machine as
    // the caller (stdio or a self-hosted HTTP server).
    if (input.startsWith('/')) {
        if (isRemoteDeployment()) {
            throw new Error(REMOTE_FILE_PATH_HELP);
        }
        const fs = await import('fs/promises');
        const { extname } = await import('path');
        const ext = extname(input).toLowerCase();
        const mimeMap = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
        };
        const mimeType = mimeMap[ext] || 'image/png';
        try {
            const buffer = await fs.readFile(input);
            return { data: buffer.toString('base64'), mimeType };
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
                throw new Error(`No such file: ${input}. ${REMOTE_FILE_PATH_HELP}`);
            }
            throw error;
        }
    }
    // Raw base64
    return { data: input, mimeType: 'image/png' };
}
/**
 * Format an error message from an unknown error type
 */
export function formatErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Create an error response object
 */
export function createErrorResponse(errorMessage) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ success: false, error: errorMessage }, null, 2),
            },
        ],
        isError: true,
    };
}
//# sourceMappingURL=utils.js.map