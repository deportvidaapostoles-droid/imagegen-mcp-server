import { describe, it, expect } from 'vitest';
import {
  isOpenAIModel,
  isGeminiModel,
  GPT_IMAGE_SIZES,
  DALLE3_SIZES,
  DALLE2_SIZES,
} from './validators.js';

describe('isOpenAIModel', () => {
  it('should return true for gpt-image models', () => {
    expect(isOpenAIModel('gpt-image-1')).toBe(true);
    expect(isOpenAIModel('gpt-image-2')).toBe(true);
  });

  it('should return true for dall-e models', () => {
    expect(isOpenAIModel('dall-e-2')).toBe(true);
    expect(isOpenAIModel('dall-e-3')).toBe(true);
  });

  it('should return true for doubao models', () => {
    expect(isOpenAIModel('doubao-seedream-4-0-250828')).toBe(true);
    expect(isOpenAIModel('volcengine/doubao-seedream-5-0-260128')).toBe(true);
  });

  it('should return false for gemini models', () => {
    expect(isOpenAIModel('gemini-2.5-flash-image')).toBe(false);
    expect(isOpenAIModel('imagen-3.0-generate-001')).toBe(false);
  });
});

describe('isGeminiModel', () => {
  it('should return true for gemini models', () => {
    expect(isGeminiModel('gemini-2.5-flash-image')).toBe(true);
    expect(isGeminiModel('gemini-2.0-flash-exp')).toBe(true);
  });

  it('should return true for imagen models', () => {
    expect(isGeminiModel('imagen-3.0-generate-001')).toBe(true);
  });

  it('should return false for openai models', () => {
    expect(isGeminiModel('gpt-image-1')).toBe(false);
    expect(isGeminiModel('dall-e-3')).toBe(false);
  });
});

describe('size constants', () => {
  it('should have correct GPT image sizes', () => {
    expect(GPT_IMAGE_SIZES).toEqual(['auto', '1024x1024', '1536x1024', '1024x1536']);
  });

  it('should have correct DALL-E 3 sizes', () => {
    expect(DALLE3_SIZES).toEqual(['1024x1024', '1792x1024', '1024x1792']);
  });

  it('should have correct DALL-E 2 sizes', () => {
    expect(DALLE2_SIZES).toEqual(['256x256', '512x512', '1024x1024']);
  });
});
