#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize API clients
let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

// Initialize OpenAI if API key is provided
if (process.env.OPENAI_API_KEY) {
  const openaiConfig: any = {
    apiKey: process.env.OPENAI_API_KEY,
  };
  
  // Allow users to override the base URL
  if (process.env.OPENAI_BASE_URL) {
    openaiConfig.baseURL = process.env.OPENAI_BASE_URL;
  }
  
  openaiClient = new OpenAI(openaiConfig);
}

// Initialize Gemini if API key is provided
if (process.env.GEMINI_API_KEY) {
  // Note: GoogleGenerativeAI doesn't support custom baseUrl in the current SDK version
  // This is a placeholder for future support. For now, users need to use proxy/redirect at network level
  geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  if (process.env.GEMINI_BASE_URL) {
    console.error("Warning: GEMINI_BASE_URL is set but custom base URLs are not currently supported by @google/generative-ai SDK");
  }
}

// Define tools
const TOOLS: Tool[] = [
  {
    name: "generate_image_openai",
    description:
      "Generate an image using OpenAI's DALL-E model. Returns the URL of the generated image.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A text description of the desired image",
        },
        model: {
          type: "string",
          description: "The model to use for image generation",
          enum: ["dall-e-2", "dall-e-3"],
          default: "dall-e-3",
        },
        size: {
          type: "string",
          description: "The size of the generated image",
          enum: ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"],
          default: "1024x1024",
        },
        quality: {
          type: "string",
          description: "The quality of the image (only for dall-e-3)",
          enum: ["standard", "hd"],
          default: "standard",
        },
        n: {
          type: "number",
          description: "The number of images to generate (1-10 for dall-e-2, only 1 for dall-e-3)",
          default: 1,
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_image_gemini",
    description:
      "Generate an image using Google's Gemini Imagen model. Note: Requires Gemini 2.0 Flash Experimental model or Imagen model access. Returns image data.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A text description of the desired image",
        },
        model: {
          type: "string",
          description: "The Gemini model to use. Use 'imagen-3.0-generate-001' for image generation or 'gemini-2.0-flash-exp' for experimental image generation",
          default: "gemini-2.0-flash-exp",
        },
        number_of_images: {
          type: "number",
          description: "The number of images to generate (currently supports 1)",
          default: 1,
          minimum: 1,
          maximum: 1,
        },
        aspect_ratio: {
          type: "string",
          description: "The aspect ratio of the generated image",
          enum: ["1:1", "3:4", "4:3", "9:16", "16:9"],
          default: "1:1",
        },
      },
      required: ["prompt"],
    },
  },
];

// Create server instance
const server = new Server(
  {
    name: "assets-gen-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const availableTools: Tool[] = [];

  if (openaiClient) {
    availableTools.push(TOOLS[0]); // OpenAI tool
  }

  if (geminiClient) {
    availableTools.push(TOOLS[1]); // Gemini tool
  }

  return { tools: availableTools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "generate_image_openai") {
      if (!openaiClient) {
        throw new Error(
          "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable."
        );
      }

      const {
        prompt,
        model = "dall-e-3",
        size = "1024x1024",
        quality = "standard",
        n = 1,
      } = args as {
        prompt: string;
        model?: "dall-e-2" | "dall-e-3";
        size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
        quality?: "standard" | "hd";
        n?: number;
      };

      // Validate size for model
      if (model === "dall-e-3") {
        if (!["1024x1024", "1792x1024", "1024x1792"].includes(size)) {
          throw new Error(
            "For dall-e-3, size must be one of: 1024x1024, 1792x1024, 1024x1792"
          );
        }
        if (n !== 1) {
          throw new Error("For dall-e-3, n must be 1");
        }
      } else if (model === "dall-e-2") {
        if (!["256x256", "512x512", "1024x1024"].includes(size)) {
          throw new Error(
            "For dall-e-2, size must be one of: 256x256, 512x512, 1024x1024"
          );
        }
        if (quality === "hd") {
          throw new Error("Quality 'hd' is only available for dall-e-3");
        }
      }

      const response = await openaiClient.images.generate({
        model,
        prompt,
        n,
        size,
        quality: model === "dall-e-3" ? quality : undefined,
      });

      if (!response.data) {
        throw new Error("No image data returned from OpenAI");
      }

      const images = response.data.map((img, idx) => ({
        index: idx,
        url: img.url,
        revised_prompt: img.revised_prompt,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                model,
                images,
              },
              null,
              2
            ),
          },
        ],
      };
    } else if (name === "generate_image_gemini") {
      if (!geminiClient) {
        throw new Error(
          "Gemini client not initialized. Please set GEMINI_API_KEY environment variable."
        );
      }

      const {
        prompt,
        model = "gemini-2.0-flash-exp",
        number_of_images = 1,
        aspect_ratio = "1:1",
      } = args as {
        prompt: string;
        model?: string;
        number_of_images?: number;
        aspect_ratio?: string;
      };

      // Validate number of images
      if (number_of_images !== 1) {
        throw new Error("Currently only 1 image generation is supported for Gemini");
      }

      const genModel = geminiClient.getGenerativeModel({ model });

      // Try to generate image using the model
      // Note: This implementation depends on the specific Gemini model capabilities
      // Some models may return inline image data, others may return URLs
      const result = await genModel.generateContent(prompt);

      const response = result.response;
      const candidates = response.candidates;

      if (!candidates || candidates.length === 0) {
        throw new Error("No candidates returned from Gemini");
      }

      // Check if response contains inline image data or text
      const results: Array<{ index: number; mimeType?: string; data?: string; text?: string }> = [];
      
      for (let candidateIdx = 0; candidateIdx < candidates.length; candidateIdx++) {
        const candidate = candidates[candidateIdx];
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.inlineData) {
              // Image data found
              results.push({
                index: candidateIdx,
                mimeType: part.inlineData.mimeType,
                data: part.inlineData.data,
              });
            } else if (part.text) {
              // Text response (model may not support image generation)
              results.push({
                index: candidateIdx,
                text: part.text,
              });
            }
          }
        }
      }

      if (results.length === 0) {
        throw new Error("No images or content were generated");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                model,
                note: results[0].text 
                  ? "Model returned text instead of image. Try using 'gemini-2.0-flash-exp' or ensure your API key has access to image generation models."
                  : "Image generated successfully",
                results,
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
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
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log initialization info to stderr (not stdout, which is used for MCP protocol)
  console.error("Assets Generation MCP Server running on stdio");
  console.error(
    `OpenAI support: ${openaiClient ? "enabled" : "disabled (OPENAI_API_KEY not set)"}`
  );
  console.error(
    `Gemini support: ${geminiClient ? "enabled" : "disabled (GEMINI_API_KEY not set)"}`
  );
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
