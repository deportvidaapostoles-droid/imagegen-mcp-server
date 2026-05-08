#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  TextContent,
  ImageContent,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { createServer } from "http";
import { getCliHelpText, getServerRuntimeConfig, loadDotEnv } from "./config.js";
import {
  detectProvider,
  getUnsupportedModelError,
  validateDallE2Params,
  validateDallE3Params,
  validateGeminiParams,
  validateOpenAICompatibleImageParams,
  validateGptImageParams,
} from "./providers.js";
import { TOOLS } from "./tools.js";
import { createErrorResponse, formatErrorMessage, openAIImageToBase64, saveBase64ToTempFile } from "./utils.js";
import type { AspectRatio, ImageQuality } from "./validators.js";

loadDotEnv();
const runtimeConfig = getServerRuntimeConfig();

if (runtimeConfig.helpRequested) {
  process.stderr.write(getCliHelpText() + '\n');
  process.exit(0);
}

const shouldEmitRuntimeLogs =
  runtimeConfig.transportMode !== 'stdio' || runtimeConfig.stdioLogsEnabled;

function logRuntime(...args: unknown[]): void {
  if (shouldEmitRuntimeLogs) {
    console.error(...args);
  }
}

// Initialize API clients
let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

// Initialize OpenAI if API key is provided
if (runtimeConfig.openaiApiKey) {
  const openaiConfig: { apiKey: string; baseURL?: string } = {
    apiKey: runtimeConfig.openaiApiKey,
  };

  // Allow users to override the base URL
  if (runtimeConfig.openaiBaseUrl) {
    openaiConfig.baseURL = runtimeConfig.openaiBaseUrl;
  }

  openaiClient = new OpenAI(openaiConfig);
}

// Initialize Gemini if API key is provided
if (runtimeConfig.geminiApiKey) {
  geminiClient = new GoogleGenAI({
    apiKey: runtimeConfig.geminiApiKey,
    httpOptions: runtimeConfig.geminiBaseUrl ? { baseUrl: runtimeConfig.geminiBaseUrl } : undefined,
  });
}

const DEFAULT_MODEL = runtimeConfig.defaultModel;

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
        timeout: timeoutSeconds = 120,
      } = args as {
        prompt: string;
        model?: string;
        size?: string;
        quality?: ImageQuality;
        n?: number;
        aspect_ratio?: AspectRatio;
        response_format?: "url" | "base64" | "auto";
        timeout?: number;
      };

      const timeoutMs = Math.max(1000, timeoutSeconds * 1000);

      // Ensure model is set (should always have default value)
      const selectedModel = model || DEFAULT_MODEL;

      const provider = detectProvider(selectedModel);
      if (!provider) {
        throw new Error(getUnsupportedModelError(selectedModel));
      }

      // Handle OpenAI models
      if (provider === "openai") {
        if (!openaiClient) {
          throw new Error(
            "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable."
          );
        }

        const isGptImageModel = selectedModel.startsWith("gpt-image");
        const openaiSize = size || (isGptImageModel ? "auto" : "1024x1024");
        const openaiQuality = quality || "standard";
        const openaiN = n || 1;

        const openAIValidation =
          isGptImageModel
            ? validateGptImageParams(openaiSize, openaiN)
            : selectedModel === "dall-e-3"
              ? validateDallE3Params(openaiSize, openaiQuality, openaiN)
              : selectedModel === "dall-e-2"
                ? validateDallE2Params(openaiSize, openaiQuality)
                : validateOpenAICompatibleImageParams(openaiN);

        if (openAIValidation) {
          throw new Error(openAIValidation.error);
        }

        const openAIResponseFormat =
          response_format === "base64"
            ? "b64_json"
            : response_format === "url"
              ? "url"
              : undefined;

        const response = await openaiClient.images.generate({
          model: selectedModel,
          prompt,
          n: openaiN,
          // OpenAI-compatible vendors such as Doubao may accept sizes beyond the SDK's built-in union.
          size: openaiSize as "auto" | "1024x1024" | "1536x1024" | "1024x1536" | "256x256" | "512x512" | "1792x1024" | "1024x1792" | null | undefined,
          quality: (selectedModel === "dall-e-3" || isGptImageModel) ? openaiQuality : undefined,
          response_format: openAIResponseFormat,
        }, { timeout: timeoutMs });

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
        let hasUrlOrSavedPath = false;

        for (const img of response.data) {
          // Preserve the original URL when response_format is "url"
          if (response_format === "url" && img.url) {
            content.push({ type: "text", text: `Image URL: ${img.url}` });
            hasUrlOrSavedPath = true;
          }

          let imageData;
          try {
            imageData = await openAIImageToBase64(img);
          } catch (error) {
            // In url mode with a URL already surfaced, downgrade to warning
            // so the caller still gets the URL. In other modes, let it propagate.
            if (response_format === "url" && img.url) {
              content.push({
                type: "text",
                text: `Warning: Failed to convert image to base64 for URL ${img.url}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
              continue;
            }
            throw error;
          }

          if (!imageData) {
            continue;
          }

          // When response_format is "url" but the API returned no URL (only base64),
          // or when response_format is "auto", save to a temp file so the caller
          // always gets a local file path regardless of the provider default format.
          if ((response_format === "url" && !img.url) || response_format === "auto") {
            const filePath = await saveBase64ToTempFile(imageData.data, imageData.mimeType);
            content.push({ type: "text", text: `Saved to: ${filePath}` });
            hasUrlOrSavedPath = true;
          }

          content.push({ type: "image", data: imageData.data, mimeType: imageData.mimeType });
        }

        if (!content.some((item) => item.type === "image")) {
          // In url mode, explicit URL/path text is a valid fallback response
          if (response_format === "url" && hasUrlOrSavedPath) {
            return { content };
          }
          throw new Error("No image data returned from OpenAI");
        }

        return { content };
      }

      // Handle Gemini models
      if (provider === "gemini") {
        if (!geminiClient) {
          throw new Error(
            "Gemini client not initialized. Please set GEMINI_API_KEY environment variable."
          );
        }

        const geminiN = n || 1;
        const geminiAspectRatio = aspect_ratio || "1:1";

        const geminiValidation = validateGeminiParams(geminiN);
        if (geminiValidation) {
          throw new Error(geminiValidation.error);
        }

        const promptWithAspectRatio = geminiAspectRatio !== "1:1" 
          ? `${prompt} (aspect ratio: ${geminiAspectRatio})`
          : prompt;

        const abortController = new AbortController();
        const abortTimer = setTimeout(() => abortController.abort(), timeoutMs);
        let result;
        try {
          result = await geminiClient.models.generateContent({
            model: selectedModel,
            contents: promptWithAspectRatio,
            config: { abortSignal: abortController.signal },
          });
        } finally {
          clearTimeout(abortTimer);
        }

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
            // When response_format is "url" or "auto", save to a temp file and return path
            if (response_format === "url" || response_format === "auto") {
              const filePath = await saveBase64ToTempFile(r.data, r.mimeType);
              content.push({ type: "text", text: `Saved to: ${filePath}` });
            }

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
    return createErrorResponse(formatErrorMessage(error));
  }
});

// Start the server
async function main() {
  runtimeConfig.warnings.forEach((warning) => {
    logRuntime(`Config warning: ${warning}`);
  });

  const transportMode = runtimeConfig.transportMode;
  
  if (transportMode === "stdio") {
    // stdio mode (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    logRuntime("Assets Generation MCP Server running on stdio");
    logRuntime(
      `OpenAI support: ${openaiClient ? "enabled" : "disabled (OPENAI_API_KEY not set)"}`
    );
    logRuntime(
      `Gemini support: ${geminiClient ? "enabled" : "disabled (GEMINI_API_KEY not set)"}`
    );
  } else if (transportMode === "sse" || transportMode === "http") {
    // SSE/HTTP mode
    const port = runtimeConfig.port;
    const host = runtimeConfig.host;
    
    logRuntime(`Assets Generation MCP Server starting on ${host}:${port} (${transportMode} mode)`);
    logRuntime(
      `OpenAI support: ${openaiClient ? "enabled" : "disabled (OPENAI_API_KEY not set)"}`
    );
    logRuntime(
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
        logRuntime('Establishing SSE connection');
        const transport = new SSEServerTransport('/message', res);
        const sessionId = transport.sessionId;
        
        // Store transport for message routing
        transports.set(sessionId, transport);
        
        // Clean up on close
        transport.onclose = () => {
          logRuntime(`SSE connection closed for session ${sessionId}`);
          transports.delete(sessionId);
        };
        
        // Connect to server (connect() calls start() automatically)
        await server.connect(transport);
        
        logRuntime(`SSE connection established with session ID: ${sessionId}`);
      } else if (url.pathname === '/message' && req.method === 'POST') {
        // Handle incoming messages
        logRuntime('Received POST message');
        
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
            logRuntime('Error handling message:', error);
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
      logRuntime(`Server listening on http://${host}:${port}`);
      logRuntime(`SSE endpoint: http://${host}:${port}/sse`);
      logRuntime(`Health check: http://${host}:${port}/`);
    });
  } else {
    throw new Error(`Unknown transport mode: ${transportMode}. Supported: stdio, sse, http`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
