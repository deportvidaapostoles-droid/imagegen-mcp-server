/**
 * Tool definitions for the MCP server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SUPPORTED_MODELS } from "./validators.js";

/**
 * Generate image tool definition
 */
export const GENERATE_IMAGE_TOOL: Tool = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt using OpenAI-compatible or Google Gemini image models. " +
    "The provider is chosen automatically from the model name: " +
    "gpt-image-* / dall-e-* / doubao-* models use the OpenAI-compatible path (requires OPENAI_API_KEY); " +
    "gemini-* / imagen-* models use the Gemini path (requires GEMINI_API_KEY). " +
    "Returns one or more MCP ImageContent blocks (base64 PNG/JPEG). " +
    "Image generation can be slow — the default timeout is 120 s; increase it with the `timeout` parameter if the provider is known to be slow.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Detailed text description of the image to generate. " +
          "More specific prompts produce better results. " +
          "Example: 'A photorealistic red apple on a white marble table, soft studio lighting, 4K'.",
      },
      model: {
        type: "string",
        description:
          "Model to use for image generation. " +
          "OpenAI-compatible: 'gpt-image-2' (recommended, best quality), 'gpt-image-1', 'dall-e-3', 'dall-e-2', " +
          "'doubao-seedream-4-0-250828', 'volcengine/doubao-seedream-5-0-260128', and any future 'doubao-*' or 'volcengine/doubao-*' models. " +
          "Gemini: 'gemini-2.5-flash-image' (fast), 'gemini-3-pro-image-preview' (high quality), " +
          "'gemini-2.0-flash-exp-image-generation', 'imagen-4.0-generate-001', 'imagen-4.0-ultra-generate-001', 'imagen-4.0-fast-generate-001'. " +
          "Omit to use the server default model (configured via DEFAULT_MODEL).",
        examples: [...SUPPORTED_MODELS],
      },
      size: {
        type: "string",
        description:
          "Output image dimensions — only applies to OpenAI-compatible models. " +
          "gpt-image-*: 'auto' (default), '1024x1024', '1536x1024' (landscape), '1024x1536' (portrait). " +
          "dall-e-3: '1024x1024', '1792x1024' (landscape), '1024x1792' (portrait). " +
          "dall-e-2: '256x256', '512x512', '1024x1024'. " +
          "Some OpenAI-compatible proxies accept additional sizes such as '2048x2048' or '4K'. " +
          "For Gemini models, use aspect_ratio instead.",
      },
      quality: {
        type: "string",
        description:
          "Image quality level. " +
          "For gpt-image-2 / gpt-image-1: 'high' (best, slowest), 'medium', 'low', 'standard' (default). " +
          "For dall-e-3: 'hd' (enhanced detail) or 'standard' (default). " +
          "Ignored for dall-e-2 and Gemini models.",
        enum: ["standard", "hd", "high", "medium", "low"],
      },
      n: {
        type: "number",
        description:
          "Number of images to generate. " +
          "gpt-image-*: 1–10. dall-e-2: 1–10. dall-e-3: must be 1. Gemini: must be 1. " +
          "Defaults to 1.",
      },
      aspect_ratio: {
        type: "string",
        description:
          "Aspect ratio of the generated image — only applies to Gemini models. " +
          "Ignored for OpenAI-compatible models (use `size` instead). " +
          "Options: '1:1' (square, default), '3:4' (portrait), '4:3' (landscape), '9:16' (tall), '16:9' (wide).",
        enum: ["1:1", "3:4", "4:3", "9:16", "16:9"],
      },
      response_format: {
        type: "string",
        description:
          "How images are returned in the MCP response. " +
          "'base64': inline base64-encoded image data (works offline, larger payload). " +
          "'url': public URL valid for ~60 minutes (OpenAI only; not supported by all proxies). " +
          "'auto' (default): saves the image to a temporary local file and returns both the file path and the inline base64 image data. This mode is the most compatible and ensures the image is always accessible regardless of provider defaults.",
        enum: ["url", "base64", "auto"],
        default: "auto",
      },
      timeout: {
        type: "number",
        description:
          "Maximum time in seconds to wait for the image generation API to respond. " +
          "Defaults to 120 s. Increase this (e.g. 180–300) if using a slow proxy or high-quality model. " +
          "The tool returns an error if the provider does not respond within this limit.",
        default: 120,
      },
    },
    required: ["prompt"],
  },
};

/**
 * All available tools
 */
export const TOOLS: Tool[] = [GENERATE_IMAGE_TOOL];

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
