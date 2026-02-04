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
        description: "The model to use for image generation. OpenAI: 'dall-e-2', 'dall-e-3'. Gemini: 'gemini-2.0-flash' (recommended), 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-exp-image-generation'. Run 'npm run models' to list all available models.",
        enum: [
          "dall-e-2",
          "dall-e-3",
          "gemini-2.0-flash",
          "gemini-2.5-flash",
          "gemini-2.5-pro",
          "gemini-2.0-flash-exp-image-generation",
        ],
        default: "gemini-2.0-flash",
      },
      size: {
        type: "string",
        description: "The size of the generated image (for OpenAI models only)",
        enum: ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"],
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
