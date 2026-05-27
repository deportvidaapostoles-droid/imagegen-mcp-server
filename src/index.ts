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
import { randomUUID } from "crypto";
import { getCliHelpText, getServerRuntimeConfig, loadDotEnv } from "./config.js";
import type { ProviderType } from "./config.js";
import {
  validateDallE2Params,
  validateDallE3Params,
  validateGeminiParams,
  validateOpenAICompatibleImageParams,
  validateGptImageParams,
} from "./providers.js";
import { createTools } from "./tools.js";
import { SUBMIT_TASK_TOOL, GET_TASK_TOOL } from "./tools.js";
import { createErrorResponse, formatErrorMessage, openAIImageToBase64, parseImageInput } from "./utils.js";
import type { ImageQuality } from "./validators.js";

// ─── Task store ─────────────────────────────────────────────────────────────

type TaskStatus = "pending" | "processing" | "completed" | "failed";

interface Task {
  id: string;
  status: TaskStatus;
  kind: "generate" | "edit";
  prompt: string;
  /** Base64-encoded result images */
  images: string[];
  mimeType: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const taskStore = new Map<string, Task>();

// Cleanup completed/failed tasks older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [id, task] of taskStore) {
    if ((task.status === "completed" || task.status === "failed") && task.updatedAt < cutoff) {
      taskStore.delete(id);
    }
  }
}, 600_000);

// ─── Config & clients ──────────────────────────────────────────────────────

loadDotEnv();
const runtimeConfig = getServerRuntimeConfig();

if (runtimeConfig.helpRequested) {
  process.stderr.write(getCliHelpText() + "\n");
  process.exit(0);
}

const shouldEmitRuntimeLogs =
  runtimeConfig.transportMode !== "stdio" || runtimeConfig.stdioLogsEnabled;

function logRuntime(...args: unknown[]): void {
  if (shouldEmitRuntimeLogs) {
    console.error(...args);
  }
}

let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

if (runtimeConfig.provider === "openai" && runtimeConfig.openaiApiKey) {
  openaiClient = new OpenAI({
    apiKey: runtimeConfig.openaiApiKey,
    ...(runtimeConfig.openaiBaseUrl ? { baseURL: runtimeConfig.openaiBaseUrl } : {}),
  });
}

if (runtimeConfig.provider === "gemini" && runtimeConfig.geminiApiKey) {
  geminiClient = new GoogleGenAI({
    apiKey: runtimeConfig.geminiApiKey,
    httpOptions: runtimeConfig.geminiBaseUrl ? { baseUrl: runtimeConfig.geminiBaseUrl } : undefined,
  });
}

const PROVIDER = runtimeConfig.provider;
const MODEL = runtimeConfig.model;
const DEFAULT_TIMEOUT = runtimeConfig.timeout;
const ASYNC_TOOLS = [SUBMIT_TASK_TOOL, GET_TASK_TOOL];
const SYNC_TOOLS = createTools(PROVIDER, DEFAULT_TIMEOUT);
const TOOLS = runtimeConfig.asyncOnly ? ASYNC_TOOLS : [...ASYNC_TOOLS, ...SYNC_TOOLS];
const BLOCKING_POLL = runtimeConfig.blockingPoll;

// ─── Server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "imagegen-mcp-server", version: "0.3.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if ((PROVIDER === "openai" && openaiClient) || (PROVIDER === "gemini" && geminiClient)) {
    return { tools: TOOLS };
  }
  return { tools: [] };
});


// ─── Sync tool handlers ─────────────────────────────────────────────────────

async function handleOpenAIGenerate(params: {
  prompt: string;
  size?: string;
  quality?: ImageQuality;
  n?: number;
  timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!openaiClient) throw new Error("OpenAI client not initialized. Please set OPENAI_API_KEY.");
  const isGptImageModel = MODEL.startsWith("gpt-image");
  const size = params.size || (isGptImageModel ? "auto" : "1024x1024");
  const quality = params.quality || "standard";
  const n = params.n || 1;
  const validation = isGptImageModel
    ? validateGptImageParams(size, n)
    : MODEL === "dall-e-3"
      ? validateDallE3Params(size, quality, n)
      : MODEL === "dall-e-2"
        ? validateDallE2Params(size, quality)
        : validateOpenAICompatibleImageParams(n);
  if (validation) throw new Error(validation.error);
  const response = await openaiClient.images.generate({
    model: MODEL, prompt: params.prompt, n,
    size: size as any,
    quality: (MODEL === "dall-e-3" || isGptImageModel) ? quality : undefined,
    response_format: "b64_json",
  }, { timeout: params.timeout });
  if (!response.data) throw new Error("No image data returned from OpenAI");
  const content: (TextContent | ImageContent)[] = [];
  const revisedPrompt = response.data[0]?.revised_prompt;
  if (revisedPrompt) content.push({ type: "text", text: `Revised prompt: ${revisedPrompt}` });
  for (const img of response.data) {
    const imageData = await openAIImageToBase64(img);
    if (imageData) content.push({ type: "image", data: imageData.data, mimeType: imageData.mimeType });
  }
  if (!content.some(item => item.type === "image")) throw new Error("No image data returned from OpenAI");
  return content;
}

async function handleOpenAIEdit(params: {
  images: string[]; prompt: string; mask?: string; size?: string;
  quality?: ImageQuality; n?: number; timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!openaiClient) throw new Error("OpenAI client not initialized. Please set OPENAI_API_KEY.");
  const { toFile } = await import("openai");
  const imageFiles = await Promise.all(
    params.images.map(async (img, i) => {
      const parsed = await parseImageInput(img);
      return toFile(Buffer.from(parsed.data, "base64"), `input_${i}.png`, { type: "image/png" });
    })
  );
  if (imageFiles.length === 0) throw new Error("At least one image is required for editing.");
  let maskFile;
  if (params.mask) {
    maskFile = await toFile(
      Buffer.from((await parseImageInput(params.mask)).data, "base64"),
      "mask.png", { type: "image/png" }
    );
  }
  const isGptImageModel = MODEL.startsWith("gpt-image");
  const size = params.size || (isGptImageModel ? "auto" : "1024x1024");
  const quality = params.quality || "standard";
  const n = params.n || 1;
  const editParams: any = {
    image: imageFiles, prompt: params.prompt, model: MODEL, response_format: "b64_json",
    ...(maskFile ? { mask: maskFile } : {}),
    ...(n ? { n } : {}), ...(quality ? { quality } : {}), ...(size ? { size } : {}),
  };
  const result = await openaiClient.images.edit(editParams, { timeout: params.timeout });
  if (!result.data) throw new Error("No image data returned from OpenAI edit");
  const content: (TextContent | ImageContent)[] = [];
  for (const img of result.data) {
    const imageData = await openAIImageToBase64(img);
    if (imageData) content.push({ type: "image", data: imageData.data, mimeType: imageData.mimeType });
  }
  if (!content.some(item => item.type === "image")) throw new Error("No image data returned from OpenAI edit");
  return content;
}

async function handleGeminiGenerate(params: {
  prompt: string; aspect_ratio?: string; n?: number; timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!geminiClient) throw new Error("Gemini client not initialized. Please set GEMINI_API_KEY.");
  const n = params.n || 1;
  const validation = validateGeminiParams(n);
  if (validation) throw new Error(validation.error);
  const aspectRatio = params.aspect_ratio || "1:1";
  const promptText = aspectRatio !== "1:1" ? `${params.prompt} (aspect ratio: ${aspectRatio})` : params.prompt;
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), params.timeout);
  let result;
  try {
    result = await geminiClient.models.generateContent({
      model: MODEL, contents: promptText, config: { abortSignal: abortController.signal },
    });
  } finally { clearTimeout(abortTimer); }
  const candidates = result.candidates;
  if (!candidates || candidates.length === 0) throw new Error("No candidates returned from Gemini");
  const content: (TextContent | ImageContent)[] = [];
  for (const candidate of candidates) {
    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          content.push({ type: "image", data: part.inlineData.data!, mimeType: part.inlineData.mimeType || "image/png" });
        } else if (part.text) {
          content.push({ type: "text", text: part.text });
        }
      }
    }
  }
  if (content.length === 0) throw new Error("No images or content were generated");
  return content;
}

async function handleGeminiEdit(params: {
  images: string[]; prompt: string; aspect_ratio?: string; n?: number; timeout: number;
}): Promise<(TextContent | ImageContent)[]> {
  if (!geminiClient) throw new Error("Gemini client not initialized. Please set GEMINI_API_KEY.");
  const n = params.n || 1;
  const validation = validateGeminiParams(n);
  if (validation) throw new Error(validation.error);
  const aspectRatio = params.aspect_ratio || "1:1";
  const imageInputs = await Promise.all(params.images.map(img => parseImageInput(img)));
  const contents: any[] = [
    ...imageInputs.map(({ data, mimeType }) => ({ inlineData: { mimeType, data } })),
    { text: params.prompt + (aspectRatio !== "1:1" ? ` (aspect ratio: ${aspectRatio})` : "") },
  ];
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), params.timeout);
  let result;
  try {
    result = await geminiClient.models.generateContent({
      model: MODEL, contents, config: { abortSignal: abortController.signal },
    });
  } finally { clearTimeout(abortTimer); }
  const candidates = result.candidates;
  if (!candidates || candidates.length === 0) throw new Error("No candidates returned from Gemini edit");
  const content: (TextContent | ImageContent)[] = [];
  for (const candidate of candidates) {
    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          content.push({ type: "image", data: part.inlineData.data!, mimeType: part.inlineData.mimeType || "image/png" });
        } else if (part.text) {
          content.push({ type: "text", text: part.text });
        }
      }
    }
  }
  if (content.length === 0) throw new Error("No images or content were returned from Gemini edit");
  return content;
}

// ─── Background task processor ──────────────────────────────────────────────

async function processTask(task: Task): Promise<void> {
  task.status = "processing";
  task.updatedAt = Date.now();

  try {
    let images: string[] = [];

    if (PROVIDER === "openai") {
      if (!openaiClient) throw new Error("OpenAI client not initialized");

      if (task.kind === "generate") {
        const isGptImageModel = MODEL.startsWith("gpt-image");
        const response = await openaiClient.images.generate({
          model: MODEL,
          prompt: task.prompt,
          n: 1,
          size: "auto" as any,
          response_format: "b64_json",
        });
        if (response.data) {
          for (const img of response.data) {
            const data = await openAIImageToBase64(img);
            if (data) images.push(data.data);
          }
        }
      } else {
        // edit: task.images contain input images, task.prompt is the edit prompt
        const { toFile } = await import("openai");
        const imageFiles = await Promise.all(
          task.images.map(async (b64, i) =>
            toFile(Buffer.from(b64, "base64"), `input_${i}.png`, { type: "image/png" })
          )
        );
        const result = await openaiClient.images.edit({
          image: imageFiles,
          prompt: task.prompt,
          model: MODEL,
          response_format: "b64_json",
        });
        if (result.data) {
          for (const img of result.data) {
            const data = await openAIImageToBase64(img);
            if (data) images.push(data.data);
          }
        }
      }
    } else {
      // Gemini
      if (!geminiClient) throw new Error("Gemini client not initialized");

      const contents: any[] = [];

      if (task.kind === "edit" && task.images.length > 0) {
        for (const b64 of task.images) {
          contents.push({ inlineData: { mimeType: "image/png", data: b64 } });
        }
      }

      contents.push({ text: task.prompt });

      const result = await geminiClient.models.generateContent({
        model: MODEL,
        contents,
      });

      const candidates = result.candidates;
      if (candidates) {
        for (const candidate of candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData?.data) {
                images.push(part.inlineData.data);
              }
            }
          }
        }
      }
    }

    if (images.length === 0) {
      throw new Error("No images were generated");
    }

    task.images = images;
    task.mimeType = "image/png";
    task.status = "completed";
  } catch (error) {
    task.status = "failed";
    task.error = formatErrorMessage(error);
  }

  task.updatedAt = Date.now();
}

// ─── Tool handlers ──────────────────────────────────────────────────────────

function handleSubmitTask(args: Record<string, unknown>): { content: (TextContent | ImageContent)[] } {
  const kind = args.kind as string;
  if (kind !== "generate" && kind !== "edit") {
    return createErrorResponse("kind must be 'generate' or 'edit'");
  }

  const prompt = args.prompt as string;
  if (!prompt) {
    return createErrorResponse("prompt is required");
  }

  const taskId = randomUUID();

  const task: Task = {
    id: taskId,
    status: "pending",
    kind,
    prompt,
    images: [],
    mimeType: "image/png",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // For edit tasks, extract images from args
  if (kind === "edit") {
    const images = args.images as string[] | undefined;
    if (!images || images.length === 0) {
      return createErrorResponse("images array is required for edit tasks");
    }
    // Parse and validate images immediately, store as base64
    const parsedImages: string[] = [];
    for (const img of images) {
      // Validate by parsing — will throw on invalid input
      // We store raw base64 strings for the background processor
      if (img.startsWith("data:image/")) {
        const match = img.match(/^data:image\/\w+;base64,(.*)$/);
        if (!match) return createErrorResponse("Invalid data URL format");
        parsedImages.push(match[1]);
      } else if (img.startsWith("/")) {
        // File path — read and convert synchronously is not ideal, but we need base64
        // For async, we'll handle in processTask
        parsedImages.push(img); // store path, processTask will parse
      } else {
        parsedImages.push(img); // raw base64
      }
    }
    task.images = parsedImages;
  }

  taskStore.set(taskId, task);

  // Kick off background processing
  processTask(task).catch((err) => {
    task.status = "failed";
    task.error = formatErrorMessage(err);
    task.updatedAt = Date.now();
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          task_id: taskId,
          status: "pending",
          message: `Task submitted. Use get_task with task_id="${taskId}" to check status.`,
        }, null, 2),
      },
    ],
  };
}

function handleGetTask(args: Record<string, unknown>): { content: (TextContent | ImageContent)[] } {
  const taskId = args.task_id as string;
  if (!taskId) {
    return createErrorResponse("task_id is required");
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return createErrorResponse(`Task not found: ${taskId}`);
  }

  // Blocking poll: wait up to 30s for task completion
  if (BLOCKING_POLL && (task.status === "pending" || task.status === "processing")) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      // Refresh task from store (processTask updates it in-place)
      const current = taskStore.get(taskId);
      if (!current || current.status === "completed" || current.status === "failed") {
        break;
      }
      // Sleep 2s between checks
      const remaining = deadline - Date.now();
      const sleepMs = Math.min(2000, remaining);
      if (sleepMs > 0) {
        const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMs));
        // Use a synchronous-like busy wait for stdio compatibility
        const start = Date.now();
        while (Date.now() - start < sleepMs) { /* busy wait */ }
      }
    }
    // Re-read final status
    const finalTask = taskStore.get(taskId);
    if (!finalTask) {
      return createErrorResponse(`Task not found: ${taskId}`);
    }
    if (finalTask.status === "completed") {
      const content: (TextContent | ImageContent)[] = [
        {
          type: "text" as const,
          text: JSON.stringify({
            task_id: taskId,
            status: "completed",
            image_count: finalTask.images.length,
          }, null, 2),
        },
      ];
      for (const b64 of finalTask.images) {
        content.push({ type: "image", data: b64, mimeType: finalTask.mimeType });
      }
      return { content };
    }
    if (finalTask.status === "failed") {
      return createErrorResponse(`Task failed: ${finalTask.error || "Unknown error"}`);
    }
    // Still processing after 30s
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            task_id: taskId,
            status: finalTask.status,
            message: "Task is still processing after 30s. Check again later.",
          }, null, 2),
        },
      ],
    };
  }

  if (task.status === "pending" || task.status === "processing") {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            task_id: taskId,
            status: task.status,
            message: "Task is still processing. Check again later.",
          }, null, 2),
        },
      ],
    };
  }

  if (task.status === "failed") {
    return createErrorResponse(`Task failed: ${task.error || "Unknown error"}`);
  }

  // completed
  const content: (TextContent | ImageContent)[] = [
    {
      type: "text" as const,
      text: JSON.stringify({
        task_id: taskId,
        status: "completed",
        image_count: task.images.length,
      }, null, 2),
    },
  ];

  for (const b64 of task.images) {
    content.push({
      type: "image",
      data: b64,
      mimeType: task.mimeType,
    });
  }

  return { content };
}

// ─── Tool execution ─────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "submit_task") {
      return handleSubmitTask(args as Record<string, unknown>);
    }

    if (name === "get_task") {
      return handleGetTask(args as Record<string, unknown>);
    }

    // Synchronous tools — direct upstream call
    if (name === "generate_image") {
      const timeoutMs = Math.max(1000, (args as any).timeout ?? DEFAULT_TIMEOUT) * 1000;
      if (PROVIDER === "openai") {
        return { content: await handleOpenAIGenerate({ prompt: (args as any).prompt, size: (args as any).size, quality: (args as any).quality, n: (args as any).n, timeout: timeoutMs }) };
      }
      if (PROVIDER === "gemini") {
        return { content: await handleGeminiGenerate({ prompt: (args as any).prompt, aspect_ratio: (args as any).aspect_ratio, n: (args as any).n, timeout: timeoutMs }) };
      }
    }

    if (name === "edit_image") {
      const timeoutMs = Math.max(1000, (args as any).timeout ?? DEFAULT_TIMEOUT) * 1000;
      if (PROVIDER === "openai") {
        return { content: await handleOpenAIEdit({ images: (args as any).images, prompt: (args as any).prompt, mask: (args as any).mask, size: (args as any).size, quality: (args as any).quality, n: (args as any).n, timeout: timeoutMs }) };
      }
      if (PROVIDER === "gemini") {
        return { content: await handleGeminiEdit({ images: (args as any).images, prompt: (args as any).prompt, aspect_ratio: (args as any).aspect_ratio, n: (args as any).n, timeout: timeoutMs }) };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return createErrorResponse(formatErrorMessage(error));
  }
});

// ─── Start server ───────────────────────────────────────────────────────────

async function main() {
  runtimeConfig.warnings.forEach((w) => logRuntime(`Config warning: ${w}`));

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
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

      const url = new URL(req.url || "", `http://${req.headers.host}`);

      if (url.pathname === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/message", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        transport.onclose = () => { transports.delete(sessionId); };
        await server.connect(transport);
        logRuntime(`SSE connection established: ${sessionId}`);
      } else if (url.pathname === "/message" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const sessionId = new URL(req.url!, `http://${req.headers.host}`).searchParams.get("sessionId");
            if (sessionId && transports.has(sessionId)) {
              await transports.get(sessionId)!.handlePostMessage(req, res, JSON.parse(body));
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "No session found" }));
            }
          } catch (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
      } else if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          transport: transportMode,
          provider: PROVIDER,
          model: MODEL,
        }));
      } else {
        res.writeHead(404);
        res.end("Not Found");
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
