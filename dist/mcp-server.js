/**
 * MCP server factory — transport agnostic.
 *
 * Builds a fully configured `Server` instance (tool list + tool execution) from
 * a runtime configuration. Every transport (stdio, local HTTP, Vercel function)
 * reuses this factory so the exposed tools stay identical everywhere.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { ImageService } from "./image-service.js";
import { TaskStore } from "./task-store.js";
import { GET_TASK_TOOL, SUBMIT_TASK_TOOL, createTools } from "./tools.js";
import { createErrorResponse, formatErrorMessage } from "./utils.js";
export const SERVER_NAME = "imagegen-mcp-server";
export const SERVER_VERSION = "0.3.0";
export function createMcpServer(config, options = {}) {
    const log = options.log ?? (() => { });
    const service = new ImageService(config);
    const taskStore = new TaskStore(service, {
        maxRetries: config.maxRetries,
        taskTimeout: config.taskTimeout,
        log,
    });
    const asyncTools = [SUBMIT_TASK_TOOL, GET_TASK_TOOL];
    const syncTools = createTools(config.provider, config.timeout);
    const tools = config.asyncOnly ? asyncTools : [...asyncTools, ...syncTools];
    const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
    // The tools are always advertised, even without provider credentials: an
    // empty list looks to a client like a broken server, while a call that
    // explains the missing API key is actionable.
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name } = request.params;
        const args = (request.params.arguments ?? {});
        try {
            switch (name) {
                case "submit_task":
                    return handleSubmitTask(taskStore, args);
                case "get_task":
                    return await handleGetTask(taskStore, config, args);
                case "generate_image": {
                    const content = await service.generate({
                        prompt: requireString(args.prompt, "prompt"),
                        size: optionalString(args.size),
                        quality: optionalString(args.quality),
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
                        quality: optionalString(args.quality),
                        aspect_ratio: optionalString(args.aspect_ratio),
                        n: optionalNumber(args.n),
                        timeout: resolveTimeout(args.timeout, config.timeout),
                    });
                    return { content };
                }
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        }
        catch (error) {
            return createErrorResponse(formatErrorMessage(error));
        }
    });
    return { server, service, taskStore, tools };
}
// ─── Tool handlers ──────────────────────────────────────────────────────────
function handleSubmitTask(taskStore, args) {
    const kind = args.kind;
    if (kind !== "generate" && kind !== "edit") {
        return createErrorResponse("kind must be 'generate' or 'edit'");
    }
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    if (!prompt) {
        return createErrorResponse("prompt is required");
    }
    let images;
    if (kind === "edit") {
        const raw = args.images;
        if (!Array.isArray(raw) || raw.length === 0) {
            return createErrorResponse("images array is required for edit tasks");
        }
        if (!raw.every((item) => typeof item === "string")) {
            return createErrorResponse("images must be an array of strings");
        }
        images = raw;
    }
    const task = taskStore.submit({ kind: kind, prompt, images });
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    task_id: task.id,
                    status: task.status,
                    message: `Task submitted. Use get_task with task_id="${task.id}" to check status.`,
                }, null, 2),
            },
        ],
    };
}
async function handleGetTask(taskStore, config, args) {
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
function completedTaskResult(task) {
    const content = [
        {
            type: "text",
            text: JSON.stringify({
                task_id: task.id,
                status: "completed",
                image_count: task.images.length,
                retries: task.retries,
                max_retries: task.maxRetries,
                task_timeout: task.taskTimeout,
            }, null, 2),
        },
    ];
    for (const data of task.images) {
        content.push({ type: "image", data, mimeType: task.mimeType });
    }
    return { content };
}
function jsonResult(payload) {
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
// ─── Argument helpers ───────────────────────────────────────────────────────
function requireString(value, field) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${field} is required`);
    }
    return value;
}
function requireStringArray(value, field) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${field} is required`);
    }
    if (!value.every((item) => typeof item === "string")) {
        throw new Error(`${field} must be an array of strings`);
    }
    return value;
}
function optionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function optionalNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
/** Tool timeouts are expressed in seconds; upstream clients take milliseconds. */
function resolveTimeout(value, fallbackSeconds) {
    const seconds = typeof value === "number" && Number.isFinite(value) ? value : fallbackSeconds;
    return Math.max(1000, seconds * 1000);
}
//# sourceMappingURL=mcp-server.js.map