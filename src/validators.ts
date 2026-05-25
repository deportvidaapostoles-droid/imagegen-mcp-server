/**
 * Validation types and functions for image generation parameters
 */

export type GPTImageSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
export type DallE3Size = '1024x1024' | '1792x1024' | '1024x1792';
export type DallE2Size = '256x256' | '512x512' | '1024x1024';

export type ImageQuality = 'standard' | 'hd' | 'high' | 'medium' | 'low';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export const GPT_IMAGE_SIZES: GPTImageSize[] = ['auto', '1024x1024', '1536x1024', '1024x1536'];
export const DALLE3_SIZES: DallE3Size[] = ['1024x1024', '1792x1024', '1024x1792'];
export const DALLE2_SIZES: DallE2Size[] = ['256x256', '512x512', '1024x1024'];

export interface ValidationError {
  valid: false;
  error: string;
}

/**
 * Validate OpenAI GPT Image parameters
 */
export function validateGptImageParams(size: string, n: number): ValidationError | null {
  if (!GPT_IMAGE_SIZES.includes(size as GPTImageSize)) {
    return { valid: false, error: `For gpt-image models, size must be one of: ${GPT_IMAGE_SIZES.join(', ')}` };
  }
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    return { valid: false, error: 'For gpt-image models, n must be between 1 and 10' };
  }
  return null;
}

/**
 * Validate OpenAI DALL-E 3 parameters
 */
export function validateDallE3Params(size: string, quality: string, n: number): ValidationError | null {
  if (!DALLE3_SIZES.includes(size as DallE3Size)) {
    return { valid: false, error: `For dall-e-3, size must be one of: ${DALLE3_SIZES.join(', ')}` };
  }
  if (n !== 1) {
    return { valid: false, error: 'For dall-e-3, n must be 1' };
  }
  return null;
}

/**
 * Validate OpenAI DALL-E 2 parameters
 */
export function validateDallE2Params(size: string, quality: string): ValidationError | null {
  if (!DALLE2_SIZES.includes(size as DallE2Size)) {
    return { valid: false, error: `For dall-e-2, size must be one of: ${DALLE2_SIZES.join(', ')}` };
  }
  if (quality === 'hd') {
    return { valid: false, error: "Quality 'hd' is only available for dall-e-3" };
  }
  return null;
}

/**
 * Validate OpenAI-compatible vendor image parameters
 */
export function validateOpenAICompatibleImageParams(n: number): ValidationError | null {
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    return { valid: false, error: 'For OpenAI-compatible image models, n must be between 1 and 10' };
  }
  return null;
}

/**
 * Validate Gemini parameters
 */
export function validateGeminiParams(n: number): ValidationError | null {
  if (n !== 1) {
    return { valid: false, error: 'Currently only 1 image generation is supported for Gemini' };
  }
  return null;
}

/**
 * Check if a model is an OpenAI-compatible model
 */
export function isOpenAIModel(model: string): boolean {
  return model.startsWith('dall-e')
    || model.startsWith('gpt-image')
    || model.startsWith('doubao-')
    || model.startsWith('volcengine/doubao-');
}

/**
 * Check if a model is a Gemini model
 */
export function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini') || model.startsWith('imagen');
}
