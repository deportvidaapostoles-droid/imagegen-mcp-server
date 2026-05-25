import { describe, it, expect } from 'vitest';
import {
  formatErrorMessage,
  createErrorResponse,
  parseImageInput,
} from './utils.js';

describe('formatErrorMessage', () => {
  it('should format Error instances', () => {
    expect(formatErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('should format non-Error values', () => {
    expect(formatErrorMessage('string error')).toBe('string error');
    expect(formatErrorMessage(42)).toBe('42');
    expect(formatErrorMessage(null)).toBe('null');
  });
});

describe('createErrorResponse', () => {
  it('should create error response with correct structure', () => {
    const response = createErrorResponse('something went wrong');

    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('something went wrong');
  });
});

describe('parseImageInput', () => {
  it('should parse data URL', async () => {
    // 1x1 red PNG
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const dataUrl = `data:image/png;base64,${base64}`;
    const result = await parseImageInput(dataUrl);
    expect(result.data).toBe(base64);
    expect(result.mimeType).toBe('image/png');
  });

  it('should parse raw base64 string', async () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const result = await parseImageInput(base64);
    expect(result.data).toBe(base64);
    expect(result.mimeType).toBe('image/png');
  });
});
