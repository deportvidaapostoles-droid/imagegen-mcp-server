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
import type { ProviderType } from "./config.js";
import {
  validateDallE2Params,
  validateDallE3Params,
  validateGeminiParams,
  validateOpenAICompatibleImageParams,
  validateGptImageParams,
  isOpenAIModel,
  isGeminiModel,
} from "./providers.js";
import { createTools } from "./tools.js";
import type { Provider } from "./tools.js";
import { createErrorResponse, formatErrorMessage, openAIImageToBase64, parseImageInput } from "./utils.js";
import type { ImageQuality } from "./validators.js";

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

if (runtimeConfig.provider === 'openai' && runtimeConfig.openaiApiKey) {
  openaiClient = new OpenAI({
    apiKey: runtimeConfig.openaiApiKey,
    ...(runtimeConfig.openaiBaseUrl ? { baseURL: runtimeConfig.openaiBaseUrl } : {}),
  });
}

if (runtimeConfig.provider === 'gemini' && runtimeConfig.geminiApiKey) {
  geminiClient = new GoogleGenAI({
    apiKey: runtimeConfig.geminiApiKey,
    httpOptions: runtimeConfig.geminiBaseUrl ? { baseUrl: runtimeConfig.geminiBaseUrl } : undefined,
  });
}

const PROVIDER = runtimeConfig.provider;
const MODEL = runtimeConfig.model;
const DEFAULT_TIMEOUT = runtimeConfig.timeout;
const TOOLS = createTools(PROVIDER, DEFAULT_TIMEOUT);

// Create server instance
const server = new Server(
  { name: "imagegen-mcp-server", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if ((PROVIDER === 'openai' && openaiClient) || (PROVIDER === 'gemini' && geminiClient)) {
    return { tools: TOOLS };
  }
  return { tools: [] };
});

// ─── OpenAI generate ────────────────────────────────────────────────────────
async function handleOpenAIGenerate(params: {
  prompt: string;
  size?: string;
  quality?: ImageQuality;
  n?: number;
  timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!openaiClient) {
    throw new Error("OpenAI client not initialized. Please set OPENAI_API_KEY.");
  }

  const isGptImageModel = MODEL.startsWith("gpt-image");
  const size = params.size || (isGptImageModel ? "auto" : "1024x1024");
  const quality = params.quality || "standard";
  const n = params.n || 1;

  // Validate
  const validation = isGptImageModel
    ? validateGptImageParams(size, n)
    : MODEL === "dall-e-3"
      ? validateDallE3Params(size, quality, n)
      : MODEL === "dall-e-2"
        ? validateDallE2Params(size, quality)
        : validateOpenAICompatibleImageParams(n);

  if (validation) throw new Error(validation.error);

  const response = await openaiClient.images.generate({
    model: MODEL,
    prompt: params.prompt,
    n,
    size: size as any,
    quality: (MODEL === "dall-e-3" || isGptImageModel) ? quality : undefined,
    response_format: "b64_json",
  }, { timeout: params.timeout });

  if (!response.data) throw new Error("No image data returned from OpenAI");

  const content: (TextContent | ImageContent)[] = [];
  const revisedPrompt = response.data[0]?.revised_prompt;
  if (revisedPrompt) {
    content.push({ type: "text", text: `Revised prompt: ${revisedPrompt}` });
  }

  for (const img of response.data) {
    const imageData = await openAIImageToBase64(img);
    if (imageData) {
      content.push({ type: "image", data: imageData.data, mimeType: imageData.mimeType });
    }
  }

  if (!content.some(item => item.type === "image")) {
    throw new Error("No image data returned from OpenAI");
  }

  return content;
}

// ─── OpenAI edit ────────────────────────────────────────────────────────────
async function handleOpenAIEdit(params: {
  images: string[];
  prompt: string;
  mask?: string;
  size?: string;
  quality?: ImageQuality;
  n?: number;
  timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!openaiClient) {
    throw new Error("OpenAI client not initialized. Please set OPENAI_API_KEY.");
  }

  const { toFile } = await import("openai");

  // OpenAI images.edit supports multiple images
  const imageFiles = await Promise.all(
    params.images.map(async (img, i) => {
      const parsed = await parseImageInput(img);
      return toFile(
        Buffer.from(parsed.data, "base64"),
        `input_${i}.png`,
        { type: "image/png" }
      );
    })
  );

  if (imageFiles.length === 0) {
    throw new Error("At least one image is required for editing.");
  }

  let maskFile;
  if (params.mask) {
    maskFile = await toFile(
      Buffer.from((await parseImageInput(params.mask)).data, "base64"),
      "mask.png",
      { type: "image/png" }
    );
  }

  const isGptImageModel = MODEL.startsWith("gpt-image");
  const size = params.size || (isGptImageModel ? "auto" : "1024x1024");
  const quality = params.quality || "standard";
  const n = params.n || 1;

  const editParams: any = {
    image: imageFiles,
    prompt: params.prompt,
    model: MODEL,
    response_format: "b64_json",
    ...(maskFile ? { mask: maskFile } : {}),
    ...(n ? { n } : {}),
    ...(quality ? { quality } : {}),
    ...(size ? { size } : {}),
  };

  const result = await openaiClient.images.edit(editParams, { timeout: params.timeout });

  if (!result.data) throw new Error("No image data returned from OpenAI edit");

  const content: (TextContent | ImageContent)[] = [];
  for (const img of result.data) {
    const imageData = await openAIImageToBase64(img);
    if (imageData) {
      content.push({ type: "image", data: imageData.data, mimeType: imageData.mimeType });
    }
  }

  if (!content.some(item => item.type === "image")) {
    throw new Error("No image data returned from OpenAI edit");
  }

  return content;
}

// ─── Gemini generate ────────────────────────────────────────────────────────
async function handleGeminiGenerate(params: {
  prompt: string;
  aspect_ratio?: string;
  n?: number;
  timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!geminiClient) {
    throw new Error("Gemini client not initialized. Please set GEMINI_API_KEY.");
  }

  const n = params.n || 1;
  const validation = validateGeminiParams(n);
  if (validation) throw new Error(validation.error);

  const aspectRatio = params.aspect_ratio || "1:1";
  const promptText = aspectRatio !== "1:1"
    ? `${params.prompt} (aspect ratio: ${aspectRatio})`
    : params.prompt;

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), params.timeout);

  let result;
  try {
    result = await geminiClient.models.generateContent({
      model: MODEL,
      contents: promptText,
      config: { abortSignal: abortController.signal },
    });
  } finally {
    clearTimeout(abortTimer);
  }

  const candidates = result.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("No candidates returned from Gemini");
  }

  const content: (TextContent | ImageContent)[] = [];

  for (const candidate of candidates) {
    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          content.push({
            type: "image",
            data: part.inlineData.data!,
            mimeType: part.inlineData.mimeType || "image/png",
          });
        } else if (part.text) {
          content.push({ type: "text", text: part.text });
        }
      }
    }
  }

  if (content.length === 0) {
    throw new Error("No images or content were generated");
  }

  return content;
}

// ─── Gemini edit ────────────────────────────────────────────────────────────
async function handleGeminiEdit(params: {
  images: string[];
  prompt: string;
  aspect_ratio?: string;
  n?: number;
  timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!geminiClient) {
    throw new Error("Gemini client not initialized. Please set GEMINI_API_KEY.");
  }

  const n = params.n || 1;
  const validation = validateGeminiParams(n);
  if (validation) throw new Error(validation.error);

  const aspectRatio = params.aspect_ratio || "1:1";

  // Parse all images
  const imageInputs = await Promise.all(params.images.map(img => parseImageInput(img)));

  // Build multimodal content: images + text prompt
  const contents: any[] = [
    ...imageInputs.map(({ data, mimeType }) => ({
      inlineData: { mimeType, data },
    })),
    {
      text: params.prompt + (aspectRatio !== "1:1" ? ` (aspect ratio: ${aspectRatio})` : ""),
    },
  ];

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), params.timeout);

  let result;
  try {
    result = await geminiClient.models.generateContent({
      model: MODEL,
      contents,
      config: { abortSignal: abortController.signal },
    });
  } finally {
    clearTimeout(abortTimer);
  }

  const candidates = result.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("No candidates returned from Gemini edit");
  }

  const content: (TextContent | ImageContent)[] = [];

  for (const candidate of candidates) {
    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          content.push({
            type: "image",
            data: part.inlineData.data!,
            mimeType: part.inlineData.mimeType || "image/png",
          });
        } else if (part.text) {
          content.push({ type: "text", text: part.text });
        }
      }
    }
  }

  if (content.length === 0) {
    throw new Error("No images or content were returned from Gemini edit");
  }

  return content;
}

// ─── Tool execution ─────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "generate_image") {
      const {
        prompt,
        size,
        quality,
        n,
        aspect_ratio,
        timeout: timeoutSeconds = DEFAULT_TIMEOUT,
      } = args as {
        prompt: string;
        size?: string;
        quality?: ImageQuality;
        n?: number;
        aspect_ratio?: string;
        timeout?: number;
      };

      const timeoutMs = Math.max(1000, timeoutSeconds * 1000);

      if (PROVIDER === "openai") {
        const content = await handleOpenAIGenerate({ prompt, size, quality, n, timeout: timeoutMs });
        return { content };
      }

      if (PROVIDER === "gemini") {
        const content = await handleGeminiGenerate({ prompt, aspect_ratio, n, timeout: timeoutMs });
        return { content };
      }

      throw new Error(`Unknown provider: ${PROVIDER}`);
    }

    if (name === "edit_image") {
      const {
        images,
        prompt,
        mask,
        size,
        quality,
        n,
        aspect_ratio,
        timeout: timeoutSeconds = DEFAULT_TIMEOUT,
      } = args as {
        images: string[];
        prompt: string;
        mask?: string;
        size?: string;
        quality?: ImageQuality;
        n?: number;
        aspect_ratio?: string;
        timeout?: number;
      };

      const timeoutMs = Math.max(1000, timeoutSeconds * 1000);

      if (PROVIDER === "openai") {
        const content = await handleOpenAIEdit({ images, prompt, mask, size, quality, n, timeout: timeoutMs });
        return { content };
      }

      if (PROVIDER === "gemini") {
        const content = await handleGeminiEdit({ images, prompt, aspect_ratio, n, timeout: timeoutMs });
        return { content };
      }

      throw new Error(`Unknown provider: ${PROVIDER}`);
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return createErrorResponse(formatErrorMessage(error));
  }
});

// ─── Start server ───────────────────────────────────────────────────────────
async function main() {
  runtimeConfig.warnings.forEach(w => logRuntime(`Config warning: ${w}`));

  const transportMode = runtimeConfig.transportMode;

  if (transportMode === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logRuntime(`ImageGen MCP Server running on stdio (provider: ${PROVIDER}, model: ${MODEL})`);
  } else if (transportMode === "sse" || transportMode === "http") {
    const port = runtimeConfig.port;
    const host = runtimeConfig.host;

    logRuntime(`ImageGen MCP Server starting on ${host}:${port} (${transportMode} mode, provider: ${PROVIDER}, model: ${MODEL})`);

    const transports = new Map<string, SSEServerTransport>();

    const httpServer = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

      const url = new URL(req.url || '', `http://${req.headers.host}`);

      if (url.pathname === '/sse' && req.method === 'GET') {
        const transport = new SSEServerTransport('/message', res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        transport.onclose = () => { transports.delete(sessionId); };
        await server.connect(transport);
        logRuntime(`SSE connection established: ${sessionId}`);
      } else if (url.pathname === '/message' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const sessionId = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('sessionId');
            if (sessionId && transports.has(sessionId)) {
              await transports.get(sessionId)!.handlePostMessage(req, res, JSON.parse(body));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No session found' }));
            }
          } catch (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
      } else if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          transport: transportMode,
          provider: PROVIDER,
          model: MODEL,
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    httpServer.listen(port, host, () => {
      logRuntime(`Server listening on http://${host}:${port}`);
    });
  } else {
    throw new Error(`Unknown transport mode: ${transportMode}`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
