import { describe, it, expect } from 'vitest';
import {
  validateOpenAICompatibleImageParams,
  validateGptImageParams,
  validateDallE3Params,
  validateDallE2Params,
  validateGeminiParams,
  detectProvider,
  getUnsupportedModelError,
  validateModel,
} from './providers.js';

describe('validateOpenAICompatibleImageParams', () => {
  it('should return null for valid n', () => {
    expect(validateOpenAICompatibleImageParams(1)).toBeNull();
    expect(validateOpenAICompatibleImageParams(10)).toBeNull();
  });

  it('should return error when n is out of range', () => {
    const result = validateOpenAICompatibleImageParams(0);
    expect(result).not.toBeNull();
    expect(result?.error).toBe('For OpenAI-compatible image models, n must be between 1 and 10');
  });
});

describe('validateGptImageParams', () => {
  it('should return null for valid params', () => {
    expect(validateGptImageParams('auto', 1)).toBeNull();
    expect(validateGptImageParams('1536x1024', 3)).toBeNull();
    expect(validateGptImageParams('1024x1536', 10)).toBeNull();
  });

  it('should return error for invalid size', () => {
    const result = validateGptImageParams('1792x1024', 1);
    expect(result).not.toBeNull();
    expect(result?.error).toContain('size must be one of');
  });

  it('should return error when n is out of range', () => {
    const result = validateGptImageParams('1024x1024', 11);
    expect(result).not.toBeNull();
    expect(result?.error).toBe('For gpt-image models, n must be between 1 and 10');
  });
});

describe('validateDallE3Params', () => {
  it('should return null for valid params', () => {
    expect(validateDallE3Params('1024x1024', 'standard', 1)).toBeNull();
    expect(validateDallE3Params('1792x1024', 'hd', 1)).toBeNull();
    expect(validateDallE3Params('1024x1792', 'standard', 1)).toBeNull();
  });

  it('should return error for invalid size', () => {
    const result = validateDallE3Params('512x512', 'standard', 1);
    expect(result).not.toBeNull();
    expect(result?.error).toContain('size must be one of');
  });

  it('should return error when n is not 1', () => {
    const result = validateDallE3Params('1024x1024', 'standard', 2);
    expect(result).not.toBeNull();
    expect(result?.error).toBe('For dall-e-3, n must be 1');
  });
});

describe('validateDallE2Params', () => {
  it('should return null for valid params', () => {
    expect(validateDallE2Params('256x256', 'standard')).toBeNull();
    expect(validateDallE2Params('512x512', 'standard')).toBeNull();
    expect(validateDallE2Params('1024x1024', 'standard')).toBeNull();
  });

  it('should return error for invalid size', () => {
    const result = validateDallE2Params('1792x1024', 'standard');
    expect(result).not.toBeNull();
    expect(result?.error).toContain('size must be one of');
  });

  it('should return error for hd quality', () => {
    const result = validateDallE2Params('512x512', 'hd');
    expect(result).not.toBeNull();
    expect(result?.error).toBe("Quality 'hd' is only available for dall-e-3");
  });
});

describe('validateGeminiParams', () => {
  it('should return null when n is 1', () => {
    expect(validateGeminiParams(1)).toBeNull();
  });

  it('should return error when n is not 1', () => {
    const result = validateGeminiParams(2);
    expect(result).not.toBeNull();
    expect(result?.error).toContain('only 1 image generation is supported');
  });

  it('should return error for n = 0', () => {
    const result = validateGeminiParams(0);
    expect(result).not.toBeNull();
  });
});

describe('detectProvider', () => {
  it('should detect OpenAI provider for dall-e models', () => {
    expect(detectProvider('dall-e-2')).toBe('openai');
    expect(detectProvider('dall-e-3')).toBe('openai');
  });

  it('should detect OpenAI provider for gpt-image models', () => {
    expect(detectProvider('gpt-image-1')).toBe('openai');
    expect(detectProvider('gpt-image-2')).toBe('openai');
  });

  it('should detect OpenAI provider for doubao models', () => {
    expect(detectProvider('doubao-seedream-4-0-250828')).toBe('openai');
    expect(detectProvider('volcengine/doubao-seedream-5-0-260128')).toBe('openai');
  });

  it('should detect Gemini provider for gemini models', () => {
    expect(detectProvider('gemini-2.0-flash-exp')).toBe('gemini');
  });

  it('should detect Gemini provider for imagen models', () => {
    expect(detectProvider('imagen-3.0-generate-001')).toBe('gemini');
  });

  it('should return null for unknown models', () => {
    expect(detectProvider('gpt-4')).toBeNull();
    expect(detectProvider('unknown')).toBeNull();
  });
});

describe('getUnsupportedModelError', () => {
  it('should include the model name in error', () => {
    const error = getUnsupportedModelError('invalid-model');
    expect(error).toContain('invalid-model');
  });

  it('should list supported models', () => {
    const error = getUnsupportedModelError('test');
    expect(error).toContain('gpt-image-2');
    expect(error).toContain('doubao-*');
    expect(error).toContain('dall-e-2');
    expect(error).toContain('dall-e-3');
    expect(error).toContain('gemini-2.5-flash-image');
    expect(error).toContain('imagen-4.0-generate-001');
  });
});

describe('validateModel', () => {
  it('should return openai provider for OpenAI image models', () => {
    const result = validateModel('gpt-image-2');
    expect('provider' in result).toBe(true);
    if ('provider' in result) {
      expect(result.provider).toBe('openai');
    }
  });

  it('should return openai provider for doubao models', () => {
    const result = validateModel('doubao-seedream-4-0-250828');
    expect('provider' in result).toBe(true);
    if ('provider' in result) {
      expect(result.provider).toBe('openai');
    }
  });

  it('should return gemini provider for gemini models', () => {
    const result = validateModel('gemini-2.0-flash-exp-image-generation');
    expect('provider' in result).toBe(true);
    if ('provider' in result) {
      expect(result.provider).toBe('gemini');
    }
  });

  it('should return error for unsupported models', () => {
    const result = validateModel('gpt-4');
    expect('valid' in result).toBe(true);
    if ('valid' in result) {
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown model');
    }
  });
});
