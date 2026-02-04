/**
 * Utility functions for the assets-gen-mcp server
 */

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
