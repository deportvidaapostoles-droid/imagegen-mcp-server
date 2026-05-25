/**
 * Tool definitions for the MCP server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Generate image tool definition
 */
export const GENERATE_IMAGE_TOOL: Tool = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt. " +
    "Returns MCP ImageContent blocks (base64 PNG/JPEG). " +
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
 * Edit image tool definition
 */
export const EDIT_IMAGE_TOOL: Tool = {
  name: "edit_image",
  description:
    "Edit an existing image using a text prompt. " +
    "The image can be an absolute file path or a base64-encoded string. " +
    "Optionally provide a mask image for inpainting (specify areas to edit). " +
    "Returns MCP ImageContent blocks (base64 PNG/JPEG).",
  inputSchema: {
    type: "object",
    properties: {
      image: {
        type: "string",
        description:
          "The image to edit. Can be an absolute file path (e.g., /path/to/image.png) or a base64-encoded image string (optionally as a data URL like data:image/png;base64,...). " +
          "Supported formats: PNG, JPEG, WebP.",
      },
      prompt: {
        type: "string",
        description:
          "A text description of the desired edit. Max 32000 characters. " +
          "Examples: 'Add a rainbow in the sky', 'Remove the person from the image', 'Change the background to a beach', 'Make the cat wear a hat'.",
      },
      mask: {
        type: "string",
        description:
          "Optional mask image for inpainting. " +
          "Can be an absolute file path or base64-encoded string. " +
          "Must be a PNG image with the same dimensions as the input image. " +
          "Fully transparent areas indicate where the edit should be applied.",
      },
      size: {
        type: "string",
        description:
          "Output image dimensions — only applies to OpenAI-compatible models. " +
          "gpt-image-*: 'auto' (default), '1024x1024', '1536x1024' (landscape), '1024x1536' (portrait). " +
          "For Gemini models, use aspect_ratio instead.",
      },
      quality: {
        type: "string",
        description:
          "Image quality level — only applies to OpenAI gpt-image-* models. " +
          "Options: 'high' (best, slowest), 'medium', 'low', 'standard' (default). " +
          "Ignored for Gemini models.",
        enum: ["standard", "hd", "high", "medium", "low"],
      },
      n: {
        type: "number",
        description:
          "Number of images to generate. OpenAI gpt-image-*: 1–10. Gemini: must be 1. " +
          "Defaults to 1.",
      },
      aspect_ratio: {
        type: "string",
        description:
          "Aspect ratio of the output image — only applies to Gemini models. " +
          "Options: '1:1' (square, default), '3:4' (portrait), '4:3' (landscape), '9:16' (tall), '16:9' (wide).",
        enum: ["1:1", "3:4", "4:3", "9:16", "16:9"],
      },
      timeout: {
        type: "number",
        description:
          "Maximum time in seconds to wait for the API to respond. " +
          "Defaults to 120 s. Increase this (e.g. 180–300) if using a slow proxy or high-quality model.",
        default: 120,
      },
    },
    required: ["image", "prompt"],
  },
};

/**
 * All available tools
 */
export const TOOLS: Tool[] = [GENERATE_IMAGE_TOOL, EDIT_IMAGE_TOOL];

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
