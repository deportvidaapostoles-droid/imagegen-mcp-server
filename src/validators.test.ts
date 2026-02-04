import { describe, it, expect } from 'vitest';
import {
  isOpenAIModel,
  isGeminiModel,
  isSupportedModel,
  SUPPORTED_MODELS,
  DALLE3_SIZES,
  DALLE2_SIZES,
} from './validators.js';

describe('isOpenAIModel', () => {
  it('should return true for dall-e-2', () => {
    expect(isOpenAIModel('dall-e-2')).toBe(true);
  });

  it('should return true for dall-e-3', () => {
    expect(isOpenAIModel('dall-e-3')).toBe(true);
  });

  it('should return false for gemini models', () => {
    expect(isOpenAIModel('gemini-2.0-flash')).toBe(false);
    expect(isOpenAIModel('gemini-2.5-flash')).toBe(false);
  });

  it('should return false for unknown models', () => {
    expect(isOpenAIModel('gpt-4')).toBe(false);
    expect(isOpenAIModel('unknown')).toBe(false);
    expect(isOpenAIModel('')).toBe(false);
  });
});

describe('isGeminiModel', () => {
  it('should return true for gemini models', () => {
    expect(isGeminiModel('gemini-2.0-flash')).toBe(true);
    expect(isGeminiModel('gemini-2.5-flash')).toBe(true);
  });

  it('should return true for imagen models', () => {
    expect(isGeminiModel('imagen-4.0-generate-001')).toBe(true);
  });

  it('should return false for OpenAI models', () => {
    expect(isGeminiModel('dall-e-2')).toBe(false);
    expect(isGeminiModel('dall-e-3')).toBe(false);
  });

  it('should return false for unknown models', () => {
    expect(isGeminiModel('gpt-4')).toBe(false);
    expect(isGeminiModel('unknown')).toBe(false);
  });
});

describe('isSupportedModel', () => {
  it('should return true for all supported models', () => {
    SUPPORTED_MODELS.forEach(model => {
      expect(isSupportedModel(model)).toBe(true);
    });
  });

  it('should return false for unsupported models', () => {
    expect(isSupportedModel('gpt-4')).toBe(false);
    expect(isSupportedModel('claude-3')).toBe(false);
    expect(isSupportedModel('')).toBe(false);
  });
});

describe('Constants', () => {
  it('should have correct DALLE3_SIZES', () => {
    expect(DALLE3_SIZES).toContain('1024x1024');
    expect(DALLE3_SIZES).toContain('1792x1024');
    expect(DALLE3_SIZES).toContain('1024x1792');
    expect(DALLE3_SIZES).toHaveLength(3);
  });

  it('should have correct DALLE2_SIZES', () => {
    expect(DALLE2_SIZES).toContain('256x256');
    expect(DALLE2_SIZES).toContain('512x512');
    expect(DALLE2_SIZES).toContain('1024x1024');
    expect(DALLE2_SIZES).toHaveLength(3);
  });

  it('should have all expected supported models', () => {
    expect(SUPPORTED_MODELS).toContain('dall-e-2');
    expect(SUPPORTED_MODELS).toContain('dall-e-3');
    expect(SUPPORTED_MODELS).toContain('gemini-2.0-flash');
    expect(SUPPORTED_MODELS).toContain('gemini-2.5-flash');
    expect(SUPPORTED_MODELS).toContain('gemini-2.5-pro');
    expect(SUPPORTED_MODELS).toContain('gemini-2.0-flash-exp-image-generation');
  });
});
