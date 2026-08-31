/**
 * Utility functions for the imagegen-mcp server
 */

/**
 * Convert an image URL to base64 encoded data
 */
/** Largest image accepted from a URL, to keep a bad link from exhausting memory. */
export const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;

export async function urlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
  try {
    const response = await fetch(url, { headers: { accept: 'image/*' } });
    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${response.status} ${response.statusText}`);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(
        `Image is too large (${Math.round(declaredLength / 1024 / 1024)} MB, limit ${MAX_REMOTE_IMAGE_BYTES / 1024 / 1024} MB)`
      );
    }

    const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim();
    if (!contentType.startsWith('image/')) {
      throw new Error(`The URL does not point to an image (content-type: ${contentType})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`Image is too large (limit ${MAX_REMOTE_IMAGE_BYTES / 1024 / 1024} MB)`);
    }

    return { data: buffer.toString('base64'), mimeType: contentType };
  } catch (error) {
    throw new Error(`Failed to fetch image from URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Normalize OpenAI-compatible image responses into base64 image data.
 * Always returns base64 data — URLs are fetched and converted.
 */
export async function openAIImageToBase64(image: {
  b64_json?: string;
  url?: string;
}): Promise<{ data: string; mimeType: string } | null> {
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
export async function parseImageInput(input: string): Promise<{ data: string; mimeType: string }> {
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
    return urlToBase64(input);
  }

  // File path — only meaningful when the server runs on the same machine as
  // the caller (stdio or a self-hosted HTTP server).
  if (input.startsWith('/')) {
    const fs = await import('fs/promises');
    const { extname } = await import('path');
    const ext = extname(input).toLowerCase();
    const mimeMap: Record<string, string> = {
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
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create an error response object
 */
export function createErrorResponse(errorMessage: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, error: errorMessage }, null, 2),
      },
    ],
    isError: true as const,
  };
}
