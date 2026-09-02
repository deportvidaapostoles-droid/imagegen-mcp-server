/**
 * MCP server factory — transport agnostic.
 *
 * Builds a fully configured `Server` instance (tool list + tool execution) from
 * a runtime configuration. Every transport (stdio, local HTTP, Vercel function)
 * reuses this factory so the exposed tools stay identical everywhere.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerRuntimeConfig } from "./config.js";
import { ImageService, type ImageBlock } from "./image-service.js";
import { TaskStore, type Task, type TaskKind } from "./task-store.js";
import {
  GET_TASK_TOOL,
  RECENT_UPLOADS_TOOL,
  SUBMIT_TASK_TOOL,
  UPLOAD_IMAGE_TOOL,
  createTools,
} from "./tools.js";
import { isUploadConfigured, listRecentImages, storeImage } from "./uploads.js";
import { createErrorResponse, formatErrorMessage } from "./utils.js";
import type { ImageQuality } from "./validators.js";

export const SERVER_NAME = "imagegen-mcp-server";
export const SERVER_VERSION = "0.3.0";

export interface McpServerBundle {
  server: Server;
  service: ImageService;
  taskStore: TaskStore;
  tools: Tool[];
}

export interface CreateMcpServerOptions {
  /** Optional logger; defaults to a no-op so stdio transport stays clean. */
  log?: (...args: unknown[]) => void;
  /**
   * Absolute URL of the drag-and-drop upload page, when the transport knows it.
   * Named in the server instructions so the model can send the user somewhere
   * concrete instead of describing an upload in the abstract.
   */
  uploadPageUrl?: string;
}

/**
 * Instructions handed to the client at `initialize`.
 *
 * The failure this heads off is specific and expensive: asked to edit a photo,
 * a model reads the file and inlines it as base64 in the tool call. Emitting a
 * megabyte of base64 one token at a time takes minutes and frequently truncates,
 * which the provider then reports as `Base64 decoding failed`. Saying so plainly
 * here is cheaper than every client rediscovering it.
 */
export function buildInstructions(uploadPageUrl?: string): string {
  const uploadPage = uploadPageUrl ?? "the server's /u page";
  const lines = [
    "Generates and edits images through a hosted image model.",
    "",
    "How to give this server an image to edit:",
    "",
    `1. An https:// URL is always the right answer. Pass it in \`images\` as is — no download, no re-encoding.`,
    `2. If the user has the image on their own machine, send them to ${uploadPage} to drop it there. This takes them seconds.`,
    "3. They do not have to copy the URL back. Once they say the photo is uploaded, call `recent_uploads` and take the newest entry — check its uploaded_at and size look like the photo they described, and say which one you picked. The list is shared by everyone using this server, so when two entries are close in time, ask rather than guess.",
    "4. Reuse that URL for every later edit of the same photo. Do not upload it again.",
    "",
    "Never do these, they do not work:",
    "",
    "- Do not pass a local file path (`/mnt/...`, `C:\\...`, `~/...`). This server runs remotely and shares no filesystem with the user or with you; a path always fails with ENOENT.",
    "- Do not read an image file and inline it as base64 in `images`. Writing out a multi-megabyte base64 string takes minutes and gets truncated on the way, which surfaces as a decoding error from the provider.",
    "",
    "`upload_image` exists for the case where you already hold small image bytes (roughly under 1 MB) and no browser is involved. For anything larger, the upload page is faster and more reliable — prefer it and say so to the user rather than attempting the base64.",
    "",
    "`generate_image` and `edit_image` block until the image is ready. Use `submit_task` plus `get_task` instead when a call would otherwise outlive the client's timeout.",
  ];
  return lines.join("\n");
}

export function createMcpServer(
  config: ServerRuntimeConfig,
  options: CreateMcpServerOptions = {}
): McpServerBundle {
  const log = options.log ?? (() => {});
  const service = new ImageService(config, log);
  const taskStore = new TaskStore(service, {
    maxRetries: config.maxRetries,
    taskTimeout: config.taskTimeout,
    log,
  });

  const asyncTools = [SUBMIT_TASK_TOOL, GET_TASK_TOOL];
  const syncTools = createTools(config.provider, config.timeout);
  // The upload tool is only useful where the bytes have somewhere to go.
  const uploadTools = isUploadConfigured() ? [UPLOAD_IMAGE_TOOL, RECENT_UPLOADS_TOOL] : [];
  const tools: Tool[] = config.asyncOnly
    ? [...uploadTools, ...asyncTools]
    : [...uploadTools, ...asyncTools, ...syncTools];

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: buildInstructions(options.uploadPageUrl) }
  );

  // The tools are always advertised, even without provider credentials: an
  // empty list looks to a client like a broken server, while a call that
  // explains the missing API key is actionable.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "upload_image":
          return await handleUploadImage(args);
        case "recent_uploads":
          return await handleRecentUploads(args);
        case "submit_task":
          return handleSubmitTask(taskStore, args);
        case "get_task":
          return await handleGetTask(taskStore, config, args);
        case "generate_image": {
          const content = await service.generate({
            prompt: requireString(args.prompt, "prompt"),
            size: optionalString(args.size),
            quality: optionalString(args.quality) as ImageQuality | undefined,
            aspect_ratio: optionalString(args.aspect_ratio),
            n: optionalNumber(args.n),
            timeout: resolveTimeout(args.timeout, config.timeout),
          });
          return { content };
        }
        case "edit_image": {
          const content = await service.edit({
            images: requireStringArray(args.images, "images"),
            prompt: requireString(args.prompt, "prompt"),
            mask: optionalString(args.mask),
            size: optionalString(args.size),
            quality: optionalString(args.quality) as ImageQuality | undefined,
            aspect_ratio: optionalString(args.aspect_ratio),
            n: optionalNumber(args.n),
            timeout: resolveTimeout(args.timeout, config.timeout),
          });
          return { content };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return createErrorResponse(formatErrorMessage(error));
    }
  });

  return { server, service, taskStore, tools };
}

// ─── Tool handlers ──────────────────────────────────────────────────────────

async function handleUploadImage(args: Record<string, unknown>): Promise<CallToolResult> {
  if (!isUploadConfigured()) {
    return createErrorResponse(
      "Uploads are not configured on this server: connect a Vercel Blob store to the project so BLOB_READ_WRITE_TOKEN is set."
    );
  }

  const image = requireString(args.image, "image");
  let base64 = image;
  let mimeType = optionalString(args.mime_type) ?? "image/png";

  const dataUrl = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(image.trim());
  if (dataUrl) {
    mimeType = dataUrl[1];
    base64 = dataUrl[2];
  } else if (/^https?:\/\//.test(image.trim())) {
    // Already reachable: nothing to store, hand the link straight back.
    return jsonResult({ url: image.trim(), message: "This image is already a URL; pass it to images as is." });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
  } catch {
    return createErrorResponse("image is not valid base64");
  }
  if (buffer.length === 0) {
    return createErrorResponse("image decoded to zero bytes — the base64 string is empty or was truncated in transit");
  }

  const result = await storeImage(buffer, mimeType);
  return jsonResult({
    ...result,
    message: "Pass this url in the images parameter of edit_image or submit_task.",
  });
}

async function handleRecentUploads(args: Record<string, unknown>): Promise<CallToolResult> {
  if (!isUploadConfigured()) {
    return createErrorResponse(
      "Uploads are not configured on this server: connect a Vercel Blob store to the project so BLOB_READ_WRITE_TOKEN is set."
    );
  }

  const requested = optionalNumber(args.limit) ?? 5;
  const limit = Math.min(20, Math.max(1, Math.trunc(requested)));
  const images = await listRecentImages(limit);
  if (images.length === 0) {
    return jsonResult({
      images: [],
      message: "Nothing has been uploaded to this server yet. Ask the user to drop the photo on the /u page first.",
    });
  }

  return jsonResult({
    images,
    message: "Newest first. Pass the url of the one the user meant in the images parameter of edit_image.",
  });
}

function handleSubmitTask(taskStore: TaskStore, args: Record<string, unknown>): CallToolResult {
  const kind = args.kind;
  if (kind !== "generate" && kind !== "edit") {
    return createErrorResponse("kind must be 'generate' or 'edit'");
  }

  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  if (!prompt) {
    return createErrorResponse("prompt is required");
  }

  let images: string[] | undefined;
  if (kind === "edit") {
    const raw = args.images;
    if (!Array.isArray(raw) || raw.length === 0) {
      return createErrorResponse("images array is required for edit tasks");
    }
    if (!raw.every((item): item is string => typeof item === "string")) {
      return createErrorResponse("images must be an array of strings");
    }
    images = raw;
  }

  const task = taskStore.submit({ kind: kind as TaskKind, prompt, images });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            task_id: task.id,
            status: task.status,
            message: `Task submitted. Use get_task with task_id="${task.id}" to check status.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetTask(
  taskStore: TaskStore,
  config: ServerRuntimeConfig,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const taskId = typeof args.task_id === "string" ? args.task_id : "";
  if (!taskId) {
    return createErrorResponse("task_id is required");
  }

  let task = taskStore.get(taskId);
  if (!task) {
    return createErrorResponse(`Task not found: ${taskId}`);
  }

  if (config.blockingPoll && (task.status === "pending" || task.status === "processing")) {
    const waited = await taskStore.waitFor(taskId, config.blockingPollTimeout * 1000);
    if (!waited) {
      return createErrorResponse(`Task not found: ${taskId}`);
    }
    task = waited;
    if (task.status === "pending" || task.status === "processing") {
      return jsonResult({
        task_id: taskId,
        status: task.status,
        message: `Task is still processing after ${config.blockingPollTimeout}s. Check again later.`,
      });
    }
  }

  if (task.status === "pending" || task.status === "processing") {
    return jsonResult({
      task_id: taskId,
      status: task.status,
      message: "Task is still processing. Check again later.",
      retries: task.retries,
      max_retries: task.maxRetries,
      task_timeout: task.taskTimeout,
    });
  }

  if (task.status === "failed") {
    return jsonResult({
      task_id: taskId,
      status: "failed",
      error: task.error || "Unknown error",
      retries: task.retries,
      max_retries: task.maxRetries,
      task_timeout: task.taskTimeout,
    });
  }

  return completedTaskResult(task);
}

function completedTaskResult(task: Task): CallToolResult {
  const content: ImageBlock[] = [
    {
      type: "text",
      text: JSON.stringify(
        {
          task_id: task.id,
          status: "completed",
          image_count: task.images.length,
          retries: task.retries,
          max_retries: task.maxRetries,
          task_timeout: task.taskTimeout,
        },
        null,
        2
      ),
    },
  ];

  for (const data of task.images) {
    content.push({ type: "image", data, mimeType: task.mimeType });
  }

  return { content };
}

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

// ─── Argument helpers ───────────────────────────────────────────────────────

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  if (!value.every((item): item is string => typeof item === "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Tool timeouts are expressed in seconds; upstream clients take milliseconds. */
function resolveTimeout(value: unknown, fallbackSeconds: number): number {
  const seconds = typeof value === "number" && Number.isFinite(value) ? value : fallbackSeconds;
  return Math.max(1000, seconds * 1000);
}
