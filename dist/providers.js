/**
 * Provider validation logic for image generation
 */
import { GPT_IMAGE_SIZES, DALLE3_SIZES, DALLE2_SIZES, } from './validators.js';
// Re-export for use in index.ts
export { isOpenAIModel, isGeminiModel } from './validators.js';
/**
 * Validate OpenAI-compatible vendor image parameters
 */
export function validateOpenAICompatibleImageParams(n) {
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
export function validateGptImageParams(size, n) {
    if (!GPT_IMAGE_SIZES.includes(size)) {
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
export function validateDallE3Params(size, quality, n) {
    if (!DALLE3_SIZES.includes(size)) {
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
export function validateDallE2Params(size, quality) {
    if (!DALLE2_SIZES.includes(size)) {
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
export function validateGeminiParams(n) {
    if (n !== 1) {
        return {
            valid: false,
            error: 'Currently only 1 image generation is supported for Gemini',
        };
    }
    return null;
}
//# sourceMappingURL=providers.js.map