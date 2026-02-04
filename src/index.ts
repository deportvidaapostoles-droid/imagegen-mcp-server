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
    console.warn("Warning: GEMINI_BASE_URL is set but custom base URLs are not currently supported by @google/generative-ai SDK");
  }
}

// Define tools
const TOOLS: Tool[] = [
  {
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
          description: "The model to use for image generation. OpenAI models: 'dall-e-2', 'dall-e-3'. Gemini models: 'gemini-2.0-flash-exp', 'imagen-3.0-generate-001'",
          enum: [
            "dall-e-2",
            "dall-e-3",
            "gemini-2.0-flash-exp",
            "imagen-3.0-generate-001",
          ],
          default: "dall-e-3",
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
    if (name === "generate_image") {
      const {
        prompt,
        model = "dall-e-3",
        size,
        quality,
        n,
        aspect_ratio,
      } = args as {
        prompt: string;
        model?: string;
        size?: string;
        quality?: string;
        n?: number;
        aspect_ratio?: string;
      };

      // Ensure model is set (should always have default value)
      const selectedModel = model || "dall-e-3";

      // Determine provider based on model
      const isOpenAI = selectedModel.startsWith("dall-e");
      const isGemini = selectedModel.startsWith("gemini") || selectedModel.startsWith("imagen");

      if (!isOpenAI && !isGemini) {
        throw new Error(
          `Unknown model: ${selectedModel}. Supported models: dall-e-2, dall-e-3, gemini-2.0-flash-exp, imagen-3.0-generate-001`
        );
      }

      // Handle OpenAI models
      if (isOpenAI) {
        if (!openaiClient) {
          throw new Error(
            "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable."
          );
        }

        const openaiModel = selectedModel as "dall-e-2" | "dall-e-3";
        const openaiSize = size || "1024x1024";
        const openaiQuality = quality || "standard";
        const openaiN = n || 1;

        // Validate size for model
        if (openaiModel === "dall-e-3") {
          if (!["1024x1024", "1792x1024", "1024x1792"].includes(openaiSize)) {
            throw new Error(
              "For dall-e-3, size must be one of: 1024x1024, 1792x1024, 1024x1792"
            );
          }
          if (openaiN !== 1) {
            throw new Error("For dall-e-3, n must be 1");
          }
        } else if (openaiModel === "dall-e-2") {
          if (!["256x256", "512x512", "1024x1024"].includes(openaiSize)) {
            throw new Error(
              "For dall-e-2, size must be one of: 256x256, 512x512, 1024x1024"
            );
          }
          if (openaiQuality === "hd") {
            throw new Error("Quality 'hd' is only available for dall-e-3");
          }
        }

        const response = await openaiClient.images.generate({
          model: openaiModel,
          prompt,
          n: openaiN,
          size: openaiSize as any,
          quality: openaiModel === "dall-e-3" ? (openaiQuality as any) : undefined,
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
                  provider: "openai",
                  model: openaiModel,
                  images,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Handle Gemini models
      if (isGemini) {
        if (!geminiClient) {
          throw new Error(
            "Gemini client not initialized. Please set GEMINI_API_KEY environment variable."
          );
        }

        const geminiN = n || 1;
        const geminiAspectRatio = aspect_ratio || "1:1";

        // Validate number of images
        if (geminiN !== 1) {
          throw new Error("Currently only 1 image generation is supported for Gemini");
        }

        const genModel = geminiClient.getGenerativeModel({ model: selectedModel });

        // Try to generate image using the model
        // Note: This implementation depends on the specific Gemini model capabilities
        // Some models may return inline image data, others may return URLs
        // The aspect_ratio parameter is included in the prompt since it's not directly supported
        // by all models through the SDK API
        const promptWithAspectRatio = geminiAspectRatio !== "1:1" 
          ? `${prompt} (aspect ratio: ${geminiAspectRatio})`
          : prompt;
        
        const result = await genModel.generateContent(promptWithAspectRatio);

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
                  provider: "gemini",
                  model: selectedModel,
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
      }

      // Safety check: This should never be reached due to validation above
      // but included for type safety and defensive programming
      throw new Error("Invalid provider state");
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
