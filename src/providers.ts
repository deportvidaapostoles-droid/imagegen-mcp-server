/**
 * Provider detection and validation logic for image generation
 */

import {
  isOpenAIModel,
  isGeminiModel,
  isSupportedModel,
  GPT_IMAGE_SIZES,
  DALLE3_SIZES,
  DALLE2_SIZES,
  type OpenAIModel,
  type ImageQuality,
  type GPTImageSize,
  type DallE3Size,
  type DallE2Size,
} from './validators.js';

export interface OpenAIValidationResult {
  valid: true;
  model: OpenAIModel;
  size: DallE3Size | DallE2Size;
  quality: ImageQuality;
  n: number;
}

export interface ValidationError {
  valid: false;
  error: string;
}

export type ValidationResult = OpenAIValidationResult | ValidationError;

/**
 * Validate OpenAI-compatible vendor image parameters
 */
export function validateOpenAICompatibleImageParams(n: number): ValidationError | null {
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    return {
      valid: false,
      error: 'For OpenAI-compatible image models, n must be between 1 and 10',
    };
  }
  return null;
}

/**
 * Validate OpenAI GPT Image parameters
 */
export function validateGptImageParams(
  size: string,
  n: number
): ValidationError | null {
  if (!GPT_IMAGE_SIZES.includes(size as GPTImageSize)) {
    return {
      valid: false,
      error: `For gpt-image models, size must be one of: ${GPT_IMAGE_SIZES.join(', ')}`,
    };
  }
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    return {
      valid: false,
      error: 'For gpt-image models, n must be between 1 and 10',
    };
  }
  return null;
}

/**
 * Validate OpenAI DALL-E 3 parameters
 */
export function validateDallE3Params(
  size: string,
  quality: string,
  n: number
): ValidationError | null {
  if (!DALLE3_SIZES.includes(size as DallE3Size)) {
    return {
      valid: false,
      error: `For dall-e-3, size must be one of: ${DALLE3_SIZES.join(', ')}`,
    };
  }
  if (n !== 1) {
    return {
      valid: false,
      error: 'For dall-e-3, n must be 1',
    };
  }
  return null;
}

/**
 * Validate OpenAI DALL-E 2 parameters
 */
export function validateDallE2Params(
  size: string,
  quality: string
): ValidationError | null {
  if (!DALLE2_SIZES.includes(size as DallE2Size)) {
    return {
      valid: false,
      error: `For dall-e-2, size must be one of: ${DALLE2_SIZES.join(', ')}`,
    };
  }
  if (quality === 'hd') {
    return {
      valid: false,
      error: "Quality 'hd' is only available for dall-e-3",
    };
  }
  return null;
}

/**
 * Validate Gemini parameters
 */
export function validateGeminiParams(n: number): ValidationError | null {
  if (n !== 1) {
    return {
      valid: false,
      error: 'Currently only 1 image generation is supported for Gemini',
    };
  }
  return null;
}

/**
 * Detect provider from model name
 */
export function detectProvider(model: string): 'openai' | 'gemini' | null {
  if (isOpenAIModel(model)) return 'openai';
  if (isGeminiModel(model)) return 'gemini';
  return null;
}

/**
 * Get error message for unsupported model
 */
export function getUnsupportedModelError(model: string): string {
  return `Unknown model: ${model}. Supported models: gpt-image-1, gpt-image-2, dall-e-2, dall-e-3, doubao-*, volcengine/doubao-*, gemini-3-pro-image-preview, gemini-2.5-flash-image, gemini-2.0-flash-exp-image-generation, imagen-4.0-generate-001, imagen-4.0-ultra-generate-001, imagen-4.0-fast-generate-001`;
}

/**
 * Validate model and return provider info
 */
export function validateModel(model: string): { provider: 'openai' | 'gemini' } | ValidationError {
  if (!isSupportedModel(model)) {
    return {
      valid: false,
      error: getUnsupportedModelError(model),
    };
  }
  
  const provider = detectProvider(model);
  if (!provider) {
    return {
      valid: false,
      error: getUnsupportedModelError(model),
    };
  }
  
  return { provider };
}
