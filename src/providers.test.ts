import { describe, it, expect } from 'vitest';
import {
  validateGptImageParams,
  validateDallE3Params,
  validateDallE2Params,
  validateGeminiParams,
  validateOpenAICompatibleImageParams,
} from './providers.js';

describe('validateGptImageParams', () => {
  it('should accept valid params', () => {
    expect(validateGptImageParams('1024x1024', 1)).toBeNull();
    expect(validateGptImageParams('auto', 5)).toBeNull();
    expect(validateGptImageParams('1536x1024', 10)).toBeNull();
  });

  it('should reject invalid size', () => {
    const result = validateGptImageParams('512x512', 1);
    expect(result).not.toBeNull();
    expect(result!.error).toContain('size must be one of');
  });

  it('should reject invalid n', () => {
    expect(validateGptImageParams('1024x1024', 0)!.error).toContain('between 1 and 10');
    expect(validateGptImageParams('1024x1024', 11)!.error).toContain('between 1 and 10');
  });
});

describe('validateDallE3Params', () => {
  it('should accept valid params', () => {
    expect(validateDallE3Params('1024x1024', 'standard', 1)).toBeNull();
    expect(validateDallE3Params('1792x1024', 'hd', 1)).toBeNull();
  });

  it('should reject invalid size', () => {
    expect(validateDallE3Params('512x512', 'standard', 1)!.error).toContain('size must be one of');
  });

  it('should reject n != 1', () => {
    expect(validateDallE3Params('1024x1024', 'standard', 2)!.error).toContain('n must be 1');
  });
});

describe('validateDallE2Params', () => {
  it('should accept valid params', () => {
    expect(validateDallE2Params('1024x1024', 'standard')).toBeNull();
    expect(validateDallE2Params('256x256', 'standard')).toBeNull();
  });

  it('should reject hd quality', () => {
    expect(validateDallE2Params('1024x1024', 'hd')!.error).toContain('hd');
  });
});

describe('validateGeminiParams', () => {
  it('should accept n=1', () => {
    expect(validateGeminiParams(1)).toBeNull();
  });

  it('should reject n != 1', () => {
    expect(validateGeminiParams(2)!.error).toContain('only 1');
  });
});

describe('validateOpenAICompatibleImageParams', () => {
  it('should accept valid n', () => {
    expect(validateOpenAICompatibleImageParams(1)).toBeNull();
    expect(validateOpenAICompatibleImageParams(5)).toBeNull();
    expect(validateOpenAICompatibleImageParams(10)).toBeNull();
  });

  it('should reject invalid n', () => {
    expect(validateOpenAICompatibleImageParams(0)!.error).toContain('between 1 and 10');
    expect(validateOpenAICompatibleImageParams(11)!.error).toContain('between 1 and 10');
  });
});
