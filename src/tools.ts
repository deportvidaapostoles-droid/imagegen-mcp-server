/**
 * Tool definitions for the MCP server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export type Provider = "openai" | "gemini";

/**
 * Create tool definitions for the given provider and timeout.
 * Only exposes parameters relevant to the active provider.
 */
export function createTools(provider: Provider, defaultTimeout: number): Tool[] {
  const providerLabel = provider === "openai" ? "OpenAI" : "Gemini";
  const imageDesc =
    "An image to edit. Can be an absolute file path (e.g., /path/to/image.png) or a base64-encoded image string (optionally as a data URL like data:image/png;base64,...). " +
    "Supported formats: PNG, JPEG, WebP.";
  const imagesNote =
    provider === "openai"
      ? " Multiple images are supported for multi-image editing."
      : " Multiple images are supported for multi-image editing.";

  // ── Shared properties ────────────────────────────────────────────────────

  const promptProp: Record<string, object> = {
    prompt: {
      type: "string",
      description:
        "Detailed text description of the image to generate. " +
        "More specific prompts produce better results. " +
        "Example: 'A photorealistic red apple on a white marble table, soft studio lighting, 4K'.",
    },
  };

  const imagesProp: Record<string, object> = {
    images: {
      type: "array",
      description:
        "One or more images to edit. Each item can be an absolute file path or a base64-encoded image string." +
        imagesNote,
      items: {
        type: "string",
        description: imageDesc,
      },
    },
  };

  const editPromptProp: Record<string, object> = {
    prompt: {
      type: "string",
      description:
        "A text description of the desired edit. Max 32000 characters. " +
        "Examples: 'Add a rainbow in the sky', 'Remove the person from the image', 'Change the background to a beach'.",
    },
  };

  const timeoutProp = (desc: string): Record<string, object> => ({
    timeout: {
      type: "number",
      description:
        desc +
        ` Defaults to ${defaultTimeout} s. Increase this if the request times out.`,
    },
  });

  // ── OpenAI-specific properties ──────────────────────────────────────────

  const openaiSizeProp: Record<string, object> = {
    size: {
      type: "string",
      description:
        "Output image dimensions. " +
        "gpt-image-*: 'auto' (default), '1024x1024', '1536x1024' (landscape), '1024x1536' (portrait). " +
        "dall-e-3: '1024x1024', '1792x1024' (landscape), '1024x1792' (portrait). " +
        "dall-e-2: '256x256', '512x512', '1024x1024'.",
    },
  };

  const openaiQualityProp: Record<string, object> = {
    quality: {
      type: "string",
      description:
        "Image quality level. " +
        "gpt-image-*: 'high' (best, slowest), 'medium', 'low', 'standard' (default). " +
        "dall-e-3: 'hd' (enhanced detail) or 'standard' (default). " +
        "Ignored for dall-e-2.",
      enum: ["standard", "hd", "high", "medium", "low"],
    },
  };

  const openaiNProp: Record<string, object> = {
    n: {
      type: "number",
      description:
        "Number of images to generate. gpt-image-*: 1–10. dall-e-2: 1–10. dall-e-3: must be 1. Defaults to 1.",
    },
  };

  const maskProp: Record<string, object> = {
    mask: {
      type: "string",
      description:
        "Optional mask image for inpainting. Can be an absolute file path or base64-encoded string. " +
        "Must be a PNG image with the same dimensions as the input image. " +
        "Fully transparent areas indicate where the edit should be applied.",
    },
  };

  // ── Gemini-specific properties ──────────────────────────────────────────

  const geminiAspectRatioProp: Record<string, object> = {
    aspect_ratio: {
      type: "string",
      description:
        "Aspect ratio of the generated image. " +
        "Options: '1:1' (square, default), '3:4' (portrait), '4:3' (landscape), '9:16' (tall), '16:9' (wide).",
      enum: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    },
  };

  // ── generate_image ──────────────────────────────────────────────────────

  const generateProperties: Record<string, object> = {
    ...promptProp,
    ...(provider === "openai" ? openaiSizeProp : geminiAspectRatioProp),
    ...(provider === "openai" ? openaiQualityProp : {}),
    ...(provider === "openai" ? openaiNProp : {}),
    ...timeoutProp("Maximum time in seconds to wait for the image generation API to respond. The tool returns an error if the provider does not respond within this limit."),
  };

  const GENERATE_IMAGE_TOOL: Tool = {
    name: "generate_image",
    description:
      `Generate an image from a text prompt using ${providerLabel}. ` +
      "Returns MCP ImageContent blocks (base64 PNG/JPEG). " +
      "Image generation can be slow — increase the timeout parameter if the request times out.",
    inputSchema: {
      type: "object",
      properties: generateProperties,
      required: ["prompt"],
    },
  };

  // ── edit_image ──────────────────────────────────────────────────────────

  const editProperties: Record<string, object> = {
    ...imagesProp,
    ...editPromptProp,
    ...(provider === "openai" ? maskProp : {}),
    ...(provider === "openai" ? openaiSizeProp : geminiAspectRatioProp),
    ...(provider === "openai" ? openaiQualityProp : {}),
    ...(provider === "openai" ? openaiNProp : {}),
    ...timeoutProp("Maximum time in seconds to wait for the API to respond."),
  };

  const EDIT_IMAGE_TOOL: Tool = {
    name: "edit_image",
    description:
      `Edit one or more images using ${providerLabel} and a text prompt. ` +
      (provider === "openai"
        ? "Optionally provide a mask image for inpainting (specify areas to edit). "
        : "") +
      "Returns MCP ImageContent blocks (base64 PNG/JPEG).",
    inputSchema: {
      type: "object",
      properties: editProperties,
      required: ["images", "prompt"],
    },
  };

  return [GENERATE_IMAGE_TOOL, EDIT_IMAGE_TOOL];
}

/**
 * Static tools for tests (OpenAI provider, 300s timeout).
 */
export const TOOLS = createTools("openai", 300);

/**
 * Get tool by name
 */
export function getToolByName(name: string): Tool | undefined {
  return TOOLS.find(tool => tool.name === name);
}

/**
 * Check if a tool name is valid
 */
export function isValidToolName(name: string): boolean {
  return TOOLS.some(tool => tool.name === name);
}
