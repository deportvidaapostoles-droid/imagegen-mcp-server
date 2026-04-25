/**
 * Validation functions for image generation parameters
 */

export type GPTImageModel = 'gpt-image-1' | 'gpt-image-2';
export type DallEModel = 'dall-e-3' | 'dall-e-2';
export type DoubaoModel = `doubao-${string}` | `volcengine/doubao-${string}`;
export type OpenAIModel = GPTImageModel | DallEModel | DoubaoModel;
export type GeminiModel = 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image' | 'gemini-2.0-flash-exp-image-generation' | 'imagen-4.0-generate-001' | 'imagen-4.0-ultra-generate-001' | 'imagen-4.0-fast-generate-001';
export type SupportedModel = OpenAIModel | GeminiModel;

export type GPTImageSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
export type DallE3Size = '1024x1024' | '1792x1024' | '1024x1792';
export type DallE2Size = '256x256' | '512x512' | '1024x1024';
export type OpenAISize = DallE2Size | DallE3Size | GPTImageSize;

export type ImageQuality = 'standard' | 'hd' | 'high' | 'medium' | 'low';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type ResponseFormat = 'url' | 'base64' | 'auto';

export const SUPPORTED_MODELS = [
  'gpt-image-1',
  'gpt-image-2',
  'dall-e-3',
  'dall-e-2',
  'doubao-seedream-4-0-250828',
  'volcengine/doubao-seedream-5-0-260128',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-exp-image-generation',
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
] as const;

export const GPT_IMAGE_SIZES: GPTImageSize[] = ['auto', '1024x1024', '1536x1024', '1024x1536'];
export const DALLE3_SIZES: DallE3Size[] = ['1024x1024', '1792x1024', '1024x1792'];
export const DALLE2_SIZES: DallE2Size[] = ['256x256', '512x512', '1024x1024'];

/**
 * Check if a model is an OpenAI model
 */
export function isOpenAIModel(model: string): model is OpenAIModel {
  return model.startsWith('dall-e')
    || model.startsWith('gpt-image')
    || model.startsWith('doubao-')
    || model.startsWith('volcengine/doubao-');
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
