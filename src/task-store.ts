/**
 * In-memory async task store for background image generation / editing.
 *
 * NOTE: the store lives in the memory of a single process. On a serverless
 * platform (Vercel) each invocation may run in a different instance, so tasks
 * submitted with `submit_task` are only observable from the same warm instance.
 * Prefer the synchronous `generate_image` / `edit_image` tools when running
 * serverless; the async tools remain available for long-lived deployments
 * (stdio / self-hosted HTTP).
 */

import { randomUUID } from "node:crypto";
import { extractImages, type ImageService } from "./image-service.js";
import { formatErrorMessage } from "./utils.js";

export type TaskStatus = "pending" | "processing" | "completed" | "failed";
export type TaskKind = "generate" | "edit";

export interface Task {
  id: string;
  status: TaskStatus;
  kind: TaskKind;
  prompt: string;
  /** Input images while pending, base64 result images once completed */
  images: string[];
  mimeType: string;
  error?: string;
  retries: number;
  maxRetries: number;
  /** Per-task upstream timeout in seconds */
  taskTimeout: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskStoreOptions {
  maxRetries: number;
  /** Upstream timeout for a single attempt, in seconds */
  taskTimeout: number;
  /** How long completed/failed tasks are retained, in milliseconds */
  retention?: number;
  log?: (...args: unknown[]) => void;
}

const DEFAULT_RETENTION_MS = 3_600_000;

export class TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly retention: number;
  private readonly log: (...args: unknown[]) => void;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly service: ImageService,
    private readonly options: TaskStoreOptions
  ) {
    this.retention = options.retention ?? DEFAULT_RETENTION_MS;
    this.log = options.log ?? (() => {});
  }

  /** Periodic cleanup — only useful in a long-lived process. */
  startCleanupTimer(intervalMs = 600_000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.prune(), intervalMs);
    this.cleanupTimer.unref?.();
  }

  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  prune(now = Date.now()): void {
    const cutoff = now - this.retention;
    for (const [id, task] of this.tasks) {
      if ((task.status === "completed" || task.status === "failed") && task.updatedAt < cutoff) {
        this.tasks.delete(id);
      }
    }
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** Create a task and start processing it in the background. */
  submit(input: { kind: TaskKind; prompt: string; images?: string[] }): Task {
    this.prune();

    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      status: "pending",
      kind: input.kind,
      prompt: input.prompt,
      images: input.images ?? [],
      mimeType: "image/png",
      retries: 0,
      maxRetries: this.options.maxRetries,
      taskTimeout: this.options.taskTimeout,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);

    void this.process(task).catch((error) => {
      task.status = "failed";
      task.error = formatErrorMessage(error);
      task.updatedAt = Date.now();
    });

    return task;
  }

  /**
   * Wait until a task reaches a terminal state or the timeout elapses.
   * Returns the task in its latest state (or undefined if it was pruned).
   */
  async waitFor(id: string, timeoutMs: number, pollIntervalMs = 500): Promise<Task | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const task = this.tasks.get(id);
      if (!task) return undefined;
      if (task.status === "completed" || task.status === "failed") return task;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return task;
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  private async process(task: Task): Promise<void> {
    task.status = "processing";
    task.updatedAt = Date.now();

    const timeoutMs = this.options.taskTimeout * 1000;
    const maxRetries = Math.max(1, this.options.maxRetries);
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const content =
          task.kind === "generate"
            ? await this.service.generate({ prompt: task.prompt, timeout: timeoutMs })
            : await this.service.edit({
                prompt: task.prompt,
                images: task.images,
                timeout: timeoutMs,
              });

        const { images, mimeType } = extractImages(content);
        if (images.length === 0) throw new Error("No images were generated");

        task.images = images;
        task.mimeType = mimeType;
        task.status = "completed";
        task.retries = attempt - 1;
        task.updatedAt = Date.now();
        return;
      } catch (error) {
        lastError = formatErrorMessage(error);
        this.log(`Task ${task.id} attempt ${attempt}/${maxRetries} failed: ${lastError}`);
        if (attempt < maxRetries) {
          await sleep(Math.min(2000 * 2 ** (attempt - 1), 10_000));
        }
      }
    }

    task.status = "failed";
    task.retries = maxRetries;
    task.error = `Failed after ${maxRetries} attempts. Last error: ${lastError}`;
    task.updatedAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
