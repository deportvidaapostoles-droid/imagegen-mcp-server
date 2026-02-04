/**
 * Provider detection and validation logic for image generation
 */

import {
  isOpenAIModel,
  isGeminiModel,
  isSupportedModel,
  DALLE3_SIZES,
  DALLE2_SIZES,
  type OpenAIModel,
  type ImageQuality,
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
  return `Unknown model: ${model}. Supported models: dall-e-2, dall-e-3, gemini-2.0-flash-exp, imagen-3.0-generate-001`;
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
