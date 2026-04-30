/**
 * Utility functions for the assets-gen-mcp server
 */

import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

/**
 * Map MIME type to file extension for common image formats.
 */
function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
  };
  return map[mimeType] || ".png";
}

/**
 * Save base64-encoded image data to a temporary file with a
 * cryptographically random filename. Returns the absolute file path.
 *
 * Security: random filenames prevent path-traversal and overwrite attacks.
 */
export async function saveBase64ToTempFile(
  data: string,
  mimeType: string,
): Promise<string> {
  const ext = mimeToExtension(mimeType);
  const filename = `${randomBytes(16).toString("hex")}${ext}`;
  const filePath = join(tmpdir(), filename);
  const buffer = Buffer.from(data, "base64");
  await writeFile(filePath, buffer);
  return filePath;
}

/**
 * Convert an image URL to base64 encoded data
 * @param url - The URL of the image to convert
 * @returns Object containing base64 data and mime type
 */
export async function urlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    
    // Try to determine mime type from response headers
    const contentType = response.headers.get('content-type') || 'image/png';
    
    return {
      data: base64,
      mimeType: contentType,
    };
  } catch (error) {
    throw new Error(`Failed to convert URL to base64: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Normalize OpenAI-compatible image responses into base64 image data.
 */
export async function openAIImageToBase64(image: {
  b64_json?: string;
  url?: string;
}): Promise<{ data: string; mimeType: string } | null> {
  if (image.b64_json) {
    return {
      data: image.b64_json,
      mimeType: 'image/png',
    };
  }

  if (image.url) {
    return urlToBase64(image.url);
  }

  return null;
}

/**
 * Format an error message from an unknown error type
 * @param error - The error to format
 * @returns Formatted error message string
 */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create a success response object
 */
export function createSuccessResponse(data: Record<string, unknown>): {
  content: Array<{ type: string; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create an error response object
 */
export function createErrorResponse(errorMessage: string): {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            success: false,
            error: errorMessage,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}
