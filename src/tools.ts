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
    "Generate an image using AI models (OpenAI DALL-E or Google Gemini). The provider is automatically selected based on the model parameter.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "A text description of the desired image",
      },
      model: {
        type: "string",
        description: "The model to use for image generation. Known OpenAI-compatible models: 'gpt-image-2', 'gpt-image-1', 'dall-e-3', 'dall-e-2', 'doubao-seedream-4-0-250828', 'volcengine/doubao-seedream-5-0-260128'. Gemini: 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'gemini-2.0-flash-exp-image-generation', 'imagen-4.0-generate-001', 'imagen-4.0-ultra-generate-001', 'imagen-4.0-fast-generate-001'. Other future 'doubao-*' and 'volcengine/doubao-*' image models are also accepted.",
        default: "gemini-3-pro-image-preview",
        examples: [...SUPPORTED_MODELS],
      },
      size: {
        type: "string",
        description: "The size of the generated image (for OpenAI-compatible models). Examples: auto, 512x512, 1024x1024, 1536x1024, 1024x1536, 2K, 4K, 2048x2048.",
      },
      quality: {
        type: "string",
        description: "The quality of the image (only for dall-e-3)",
        enum: ["standard", "hd"],
      },
      n: {
        type: "number",
        description: "The number of images to generate (for OpenAI: 1-10 for dall-e-2, 1 for dall-e-3; for Gemini: only 1)",
      },
      aspect_ratio: {
        type: "string",
        description: "The aspect ratio of the generated image (for Gemini models only)",
        enum: ["1:1", "3:4", "4:3", "9:16", "16:9"],
      },
      response_format: {
        type: "string",
        description: "Format for returning images: 'url' (URLs), 'base64' (base64-encoded data), or 'auto' (provider default: URLs for OpenAI, base64 for Gemini)",
        enum: ["url", "base64", "auto"],
        default: "auto",
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
