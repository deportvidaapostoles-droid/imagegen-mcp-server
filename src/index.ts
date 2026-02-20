#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
  ImageContent,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { createServer } from "http";

// Initialize API clients
let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

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
  geminiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : undefined,
  });
}

// Helper function to convert image URL to base64
async function urlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
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

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemini-2.5-flash-image";

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
        response_format: {
          type: "string",
          description: "Format for returning images: 'url' (URLs), 'base64' (base64-encoded data), or 'auto' (provider default: URLs for OpenAI, base64 for Gemini)",
          enum: ["url", "base64", "auto"],
          default: "auto",
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
  // Only expose the generate_image tool if at least one provider is available
  if (openaiClient || geminiClient) {
    return { tools: TOOLS };
  }
  return { tools: [] };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "generate_image") {
      const {
        prompt,
        model = DEFAULT_MODEL,
        size,
        quality,
        n,
        aspect_ratio,
        response_format = "auto",
      } = args as {
        prompt: string;
        model?: string;
        size?: string;
        quality?: string;
        n?: number;
        aspect_ratio?: string;
        response_format?: "url" | "base64" | "auto";
      };

      // Ensure model is set (should always have default value)
      const selectedModel = model || DEFAULT_MODEL;

      // Determine provider based on model
      const isOpenAI = selectedModel.startsWith("dall-e") || selectedModel.startsWith("gpt-image");
      const isGemini = selectedModel.startsWith("gemini") || selectedModel.startsWith("imagen");

      if (!isOpenAI && !isGemini) {
        throw new Error(
          `Unknown model: ${selectedModel}. Supported models: gpt-image-1, dall-e-3, dall-e-2, gemini-3-pro-image-preview, gemini-2.5-flash-image, imagen-4.0-*. Run 'npm run models' to list all available models.`
        );
      }

      // Handle OpenAI models
      if (isOpenAI) {
        if (!openaiClient) {
          throw new Error(
            "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable."
          );
        }

        const openaiModel = selectedModel as "gpt-image-1" | "dall-e-3" | "dall-e-2";
        const openaiSize = size || "1024x1024";
        const openaiQuality = quality || "standard";
        const openaiN = n || 1;

        // Validate size for model
        if (openaiModel === "dall-e-3" || openaiModel === "gpt-image-1") {
          if (!["1024x1024", "1792x1024", "1024x1792"].includes(openaiSize)) {
            throw new Error(
              "For dall-e-3/gpt-image-1, size must be one of: 1024x1024, 1792x1024, 1024x1792"
            );
          }
          if (openaiN !== 1) {
            throw new Error("For dall-e-3/gpt-image-1, n must be 1");
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

        // Build MCP content blocks
        const content: (TextContent | ImageContent)[] = [];

        // Add metadata as text
        const revisedPrompt = response.data[0]?.revised_prompt;
        if (revisedPrompt) {
          content.push({ type: "text", text: `Revised prompt: ${revisedPrompt}` });
        }

        // Convert all images to MCP ImageContent
        for (const img of response.data) {
          if (!img.url) continue;
          const { data, mimeType } = await urlToBase64(img.url);
          content.push({ type: "image", data, mimeType });
        }

        return { content };
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

        const promptWithAspectRatio = geminiAspectRatio !== "1:1" 
          ? `${prompt} (aspect ratio: ${geminiAspectRatio})`
          : prompt;
        
        const result = await geminiClient.models.generateContent({
          model: selectedModel,
          contents: promptWithAspectRatio,
        });

        const candidates = result.candidates;

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
                results.push({
                  index: candidateIdx,
                  mimeType: part.inlineData.mimeType,
                  data: part.inlineData.data,
                });
              } else if (part.text) {
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

        // Build MCP content blocks
        const content: (TextContent | ImageContent)[] = [];

        for (const r of results) {
          if (r.data && r.mimeType) {
            content.push({ type: "image", data: r.data, mimeType: r.mimeType });
          } else if (r.text) {
            content.push({ type: "text", text: r.text });
          }
        }

        return { content };
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
  const transportMode = process.env.MCP_TRANSPORT || "stdio";
  
  if (transportMode === "stdio") {
    // stdio mode (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error("Assets Generation MCP Server running on stdio");
    console.error(
      `OpenAI support: ${openaiClient ? "enabled" : "disabled (OPENAI_API_KEY not set)"}`
    );
    console.error(
      `Gemini support: ${geminiClient ? "enabled" : "disabled (GEMINI_API_KEY not set)"}`
    );
  } else if (transportMode === "sse" || transportMode === "http") {
    // SSE/HTTP mode
    const port = parseInt(process.env.MCP_PORT || "3000", 10);
    const host = process.env.MCP_HOST || "localhost";
    
    console.error(`Assets Generation MCP Server starting on ${host}:${port} (${transportMode} mode)`);
    console.error(
      `OpenAI support: ${openaiClient ? "enabled" : "disabled (OPENAI_API_KEY not set)"}`
    );
    console.error(
      `Gemini support: ${geminiClient ? "enabled" : "disabled (GEMINI_API_KEY not set)"}`
    );
    
    // Store transports by session ID for proper message routing
    const transports = new Map<string, SSEServerTransport>();
    
    // Create HTTP server for SSE transport
    const httpServer = createServer(async (req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      
      if (url.pathname === '/sse' && req.method === 'GET') {
        // Establish SSE connection
        console.error('Establishing SSE connection');
        const transport = new SSEServerTransport('/message', res);
        const sessionId = transport.sessionId;
        
        // Store transport for message routing
        transports.set(sessionId, transport);
        
        // Clean up on close
        transport.onclose = () => {
          console.error(`SSE connection closed for session ${sessionId}`);
          transports.delete(sessionId);
        };
        
        // Connect to server (connect() calls start() automatically)
        await server.connect(transport);
        
        console.error(`SSE connection established with session ID: ${sessionId}`);
      } else if (url.pathname === '/message' && req.method === 'POST') {
        // Handle incoming messages
        console.error('Received POST message');
        
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', async () => {
          try {
            const message = JSON.parse(body);
            
            // Extract session ID from message or headers
            // The SSE transport should include the session ID in the message or we can get it from URL params
            const sessionId = url.searchParams.get('sessionId');
            
            if (sessionId && transports.has(sessionId)) {
              const transport = transports.get(sessionId)!;
              await transport.handlePostMessage(req, res, message);
            } else {
              // If no specific transport, this could be a stateless request
              // For now, return error
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'No session found. Please establish SSE connection first or include sessionId parameter.' 
              }));
            }
          } catch (error) {
            console.error('Error handling message:', error);
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
      } else if (url.pathname === '/' && req.method === 'GET') {
        // Health check endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ok',
          transport: transportMode,
          openai: openaiClient ? 'enabled' : 'disabled',
          gemini: geminiClient ? 'enabled' : 'disabled'
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    httpServer.listen(port, host, () => {
      console.error(`Server listening on http://${host}:${port}`);
      console.error(`SSE endpoint: http://${host}:${port}/sse`);
      console.error(`Health check: http://${host}:${port}/`);
    });
  } else {
    throw new Error(`Unknown transport mode: ${transportMode}. Supported: stdio, sse, http`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
