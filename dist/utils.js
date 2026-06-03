/**
 * Utility functions for the imagegen-mcp server
 */
/**
 * Convert an image URL to base64 encoded data
 */
export async function urlToBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const contentType = response.headers.get('content-type') || 'image/png';
        return { data: base64, mimeType: contentType };
    }
    catch (error) {
        throw new Error(`Failed to convert URL to base64: ${error instanceof Error ? error.message : String(error)}`);
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
    // File path
    if (input.startsWith('/')) {
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
        const buffer = await fs.readFile(input);
        return { data: buffer.toString('base64'), mimeType };
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