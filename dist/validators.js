/**
 * Validation types and functions for image generation parameters
 */
export const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'];
export const DALLE3_SIZES = ['1024x1024', '1792x1024', '1024x1792'];
export const DALLE2_SIZES = ['256x256', '512x512', '1024x1024'];
/**
 * Validate OpenAI GPT Image parameters
 */
export function validateGptImageParams(size, n) {
    if (!GPT_IMAGE_SIZES.includes(size)) {
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
export function validateDallE3Params(size, quality, n) {
    if (!DALLE3_SIZES.includes(size)) {
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
export function validateDallE2Params(size, quality) {
    if (!DALLE2_SIZES.includes(size)) {
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
export function validateOpenAICompatibleImageParams(n) {
    if (!Number.isInteger(n) || n < 1 || n > 10) {
        return { valid: false, error: 'For OpenAI-compatible image models, n must be between 1 and 10' };
    }
    return null;
}
/**
 * Validate Gemini parameters
 */
export function validateGeminiParams(n) {
    if (n !== 1) {
        return { valid: false, error: 'Currently only 1 image generation is supported for Gemini' };
    }
    return null;
}
/**
 * Check if a model is an OpenAI-compatible model
 */
export function isOpenAIModel(model) {
    return model.startsWith('dall-e')
        || model.startsWith('gpt-image')
        || model.startsWith('doubao-')
        || model.startsWith('volcengine/doubao-');
}
/**
 * Check if a model is a Gemini model
 */
export function isGeminiModel(model) {
    return model.startsWith('gemini') || model.startsWith('imagen');
}
//# sourceMappingURL=validators.js.map