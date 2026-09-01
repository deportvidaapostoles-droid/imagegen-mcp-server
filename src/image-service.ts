/**
 * Image generation / editing service.
 *
 * Wraps the upstream providers (OpenAI-compatible and Google Gemini) and exposes
 * transport-agnostic `generate` / `edit` operations that return MCP content blocks.
 * This module has no knowledge of MCP transports, HTTP or the CLI.
 */

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { ProviderType, ServerRuntimeConfig } from "./config.js";
import {
  validateDallE2Params,
  validateDallE3Params,
  validateGeminiParams,
  validateGptImageParams,
  validateOpenAICompatibleImageParams,
} from "./providers.js";
import { openAIImageToBase64, parseImageInput } from "./utils.js";
import type { ImageQuality } from "./validators.js";

export type ImageBlock = TextContent | ImageContent;

/** Attempts per request when the provider reports it is busy. */
const MAX_TRANSIENT_ATTEMPTS = 3;

export interface GenerateParams {
  prompt: string;
  /** OpenAI only */
  size?: string;
  /** OpenAI only */
  quality?: ImageQuality;
  /** Gemini only */
  aspect_ratio?: string;
  n?: number;
  /** Timeout in milliseconds */
  timeout: number;
}

export interface EditParams extends GenerateParams {
  /** File paths, data URLs or raw base64 strings */
  images: string[];
  /** OpenAI only */
  mask?: string;
}


/** Upstream hiccups worth a second try: the provider is busy, not the request wrong. */
function isTransientUpstreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|high demand|overloaded|try again later|temporarily/i.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ImageService {
  readonly provider: ProviderType;
  readonly model: string;

  private readonly openai: OpenAI | null = null;
  private readonly gemini: GoogleGenAI | null = null;
  private readonly log: (...args: unknown[]) => void;

  constructor(config: ServerRuntimeConfig, log: (...args: unknown[]) => void = () => {}) {
    this.log = log;
    this.provider = config.provider;
    this.model = config.model;

    if (config.provider === "openai" && config.openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: config.openaiApiKey,
        ...(config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : {}),
      });
    }

    if (config.provider === "gemini" && config.geminiApiKey) {
      this.gemini = new GoogleGenAI({
        apiKey: config.geminiApiKey,
        httpOptions: config.geminiBaseUrl ? { baseUrl: config.geminiBaseUrl } : undefined,
      });
    }
  }

  /** True when the configured provider has usable credentials. */
  get isConfigured(): boolean {
    return this.openai !== null || this.gemini !== null;
  }

  /** Human readable reason why the service is unusable, if any. */
  get configurationError(): string | null {
    if (this.isConfigured) return null;
    return this.provider === "openai"
      ? "OpenAI client not initialized. Please set OPENAI_API_KEY."
      : "Gemini client not initialized. Please set GEMINI_API_KEY.";
  }

  async generate(params: GenerateParams): Promise<ImageBlock[]> {
    return this.withRetry(params.timeout, () =>
      this.provider === "openai" ? this.openaiGenerate(params) : this.geminiGenerate(params)
    );
  }

  async edit(params: EditParams): Promise<ImageBlock[]> {
    return this.withRetry(params.timeout, () =>
      this.provider === "openai" ? this.openaiEdit(params) : this.geminiEdit(params)
    );
  }

  /**
   * Retry a request the provider refused because it was busy, while the caller's
   * own timeout still has room. A saturated image model answers 503 within a
   * second, so a short pause often costs less than surfacing the failure.
   */
  private async withRetry<T>(budgetMs: number, run: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + budgetMs;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const backoff = 1500 * attempt;
        if (
          attempt >= MAX_TRANSIENT_ATTEMPTS ||
          !isTransientUpstreamError(error) ||
          Date.now() + backoff >= deadline
        ) {
          throw error;
        }
        this.log(`Provider busy (attempt ${attempt}/${MAX_TRANSIENT_ATTEMPTS}), retrying in ${backoff} ms`);
        await sleep(backoff);
      }
    }
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────

  private async openaiGenerate(params: GenerateParams): Promise<ImageBlock[]> {
    const client = this.requireOpenAI();
    const isGptImageModel = this.model.startsWith("gpt-image");
    const size = params.size || (isGptImageModel ? "auto" : "1024x1024");
    const quality = params.quality || "standard";
    const n = params.n || 1;

    const validation = isGptImageModel
      ? validateGptImageParams(size, n)
      : this.model === "dall-e-3"
        ? validateDallE3Params(size, quality, n)
        : this.model === "dall-e-2"
          ? validateDallE2Params(size, quality)
          : validateOpenAICompatibleImageParams(n);
    if (validation) throw new Error(validation.error);

    const response = await client.images.generate(
      {
        model: this.model,
        prompt: params.prompt,
        n,
        size: size as any,
        quality: this.model === "dall-e-3" || isGptImageModel ? quality : undefined,
        response_format: "b64_json",
      },
      { timeout: params.timeout }
    );

    if (!response.data) throw new Error("No image data returned from OpenAI");

    const content: ImageBlock[] = [];
    const revisedPrompt = response.data[0]?.revised_prompt;
    if (revisedPrompt) content.push({ type: "text", text: `Revised prompt: ${revisedPrompt}` });
    for (const img of response.data) {
      const imageData = await openAIImageToBase64(img);
      if (imageData) content.push({ type: "image", data: imageData.data, mimeType: imageData.mimeType });
    }
    if (!content.some((item) => item.type === "image")) {
      throw new Error("No image data returned from OpenAI");
    }
    return content;
  }

  private async openaiEdit(params: EditParams): Promise<ImageBlock[]> {
    const client = this.requireOpenAI();
    if (!params.images || params.images.length === 0) {
      throw new Error("At least one image is required for editing.");
    }

    const { toFile } = await import("openai");
    const imageFiles = await Promise.all(
      params.images.map(async (img, i) => {
        const parsed = await parseImageInput(img);
        return toFile(Buffer.from(parsed.data, "base64"), `input_${i}.png`, { type: "image/png" });
      })
    );

    let maskFile;
    if (params.mask) {
      const parsedMask = await parseImageInput(params.mask);
      maskFile = await toFile(Buffer.from(parsedMask.data, "base64"), "mask.png", {
        type: "image/png",
      });
    }

    const isGptImageModel = this.model.startsWith("gpt-image");
    const size = params.size || (isGptImageModel ? "auto" : "1024x1024");
    const quality = params.quality || "standard";
    const n = params.n || 1;

    const editParams: any = {
      image: imageFiles,
      prompt: params.prompt,
      model: this.model,
      response_format: "b64_json",
      ...(maskFile ? { mask: maskFile } : {}),
      ...(n ? { n } : {}),
      ...(quality ? { quality } : {}),
      ...(size ? { size } : {}),
    };

    const result = await client.images.edit(editParams, { timeout: params.timeout });
    if (!result.data) throw new Error("No image data returned from OpenAI edit");

    const content: ImageBlock[] = [];
    for (const img of result.data) {
      const imageData = await openAIImageToBase64(img);
      if (imageData) content.push({ type: "image", data: imageData.data, mimeType: imageData.mimeType });
    }
    if (!content.some((item) => item.type === "image")) {
      throw new Error("No image data returned from OpenAI edit");
    }
    return content;
  }

  // ── Gemini ────────────────────────────────────────────────────────────────

  private async geminiGenerate(params: GenerateParams): Promise<ImageBlock[]> {
    const client = this.requireGemini();
    const n = params.n || 1;
    const validation = validateGeminiParams(n);
    if (validation) throw new Error(validation.error);

    const aspectRatio = params.aspect_ratio || "1:1";
    const promptText =
      aspectRatio !== "1:1" ? `${params.prompt} (aspect ratio: ${aspectRatio})` : params.prompt;

    const result = await this.withAbort(params.timeout, (abortSignal) =>
      client.models.generateContent({
        model: this.model,
        contents: promptText,
        config: { abortSignal },
      })
    );

    const content = collectGeminiContent(result.candidates);
    if (content.length === 0) throw new Error("No images or content were generated");
    return content;
  }

  private async geminiEdit(params: EditParams): Promise<ImageBlock[]> {
    const client = this.requireGemini();
    const n = params.n || 1;
    const validation = validateGeminiParams(n);
    if (validation) throw new Error(validation.error);
    if (!params.images || params.images.length === 0) {
      throw new Error("At least one image is required for editing.");
    }

    const aspectRatio = params.aspect_ratio || "1:1";
    const imageInputs = await Promise.all(params.images.map((img) => parseImageInput(img)));
    const contents: any[] = [
      ...imageInputs.map(({ data, mimeType }) => ({ inlineData: { mimeType, data } })),
      { text: params.prompt + (aspectRatio !== "1:1" ? ` (aspect ratio: ${aspectRatio})` : "") },
    ];

    const result = await this.withAbort(params.timeout, (abortSignal) =>
      client.models.generateContent({
        model: this.model,
        contents,
        config: { abortSignal },
      })
    );

    const content = collectGeminiContent(result.candidates);
    if (content.length === 0) throw new Error("No images or content were returned from Gemini edit");
    return content;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private requireOpenAI(): OpenAI {
    if (!this.openai) throw new Error("OpenAI client not initialized. Please set OPENAI_API_KEY.");
    return this.openai;
  }

  private requireGemini(): GoogleGenAI {
    if (!this.gemini) throw new Error("Gemini client not initialized. Please set GEMINI_API_KEY.");
    return this.gemini;
  }

  private async withAbort<T>(timeout: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

function collectGeminiContent(candidates: unknown): ImageBlock[] {
  const content: ImageBlock[] = [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("No candidates returned from Gemini");
  }
  for (const candidate of candidates as any[]) {
    for (const part of candidate?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        content.push({
          type: "image",
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      } else if (part.text) {
        content.push({ type: "text", text: part.text });
      }
    }
  }
  return content;
}

/** Extract the base64 payloads of every image block in a content array. */
export function extractImages(content: ImageBlock[]): { images: string[]; mimeType: string } {
  const images: string[] = [];
  let mimeType = "image/png";
  for (const block of content) {
    if (block.type === "image") {
      images.push(block.data);
      mimeType = block.mimeType || mimeType;
    }
  }
  return { images, mimeType };
}
