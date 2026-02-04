/**
 * Validation functions for image generation parameters
 */

export type OpenAIModel = 'dall-e-2' | 'dall-e-3';
export type GeminiModel = 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image' | 'gemini-2.0-flash-exp-image-generation' | 'imagen-4.0-generate-001' | 'imagen-4.0-ultra-generate-001' | 'imagen-4.0-fast-generate-001';
export type SupportedModel = OpenAIModel | GeminiModel;

export type DallE3Size = '1024x1024' | '1792x1024' | '1024x1792';
export type DallE2Size = '256x256' | '512x512' | '1024x1024';
export type OpenAISize = DallE2Size | DallE3Size;

export type ImageQuality = 'standard' | 'hd';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type ResponseFormat = 'url' | 'base64' | 'auto';

export const SUPPORTED_MODELS = [
  'dall-e-2',
  'dall-e-3',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-exp-image-generation',
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
] as const;

export const DALLE3_SIZES: DallE3Size[] = ['1024x1024', '1792x1024', '1024x1792'];
export const DALLE2_SIZES: DallE2Size[] = ['256x256', '512x512', '1024x1024'];

/**
 * Check if a model is an OpenAI model
 */
export function isOpenAIModel(model: string): model is OpenAIModel {
  return model.startsWith('dall-e');
}

/**
 * Check if a model is a Gemini model
 */
export function isGeminiModel(model: string): model is GeminiModel {
  return model.startsWith('gemini') || model.startsWith('imagen');
}

/**
 * Check if a model is supported
 */
export function isSupportedModel(model: string): model is SupportedModel {
  return isOpenAIModel(model) || isGeminiModel(model);
}
