import { describe, it, expect } from 'vitest';
import {
  createTools,
  TOOLS,
  getToolByName,
  isValidToolName,
} from './tools.js';

// TOOLS is created with ("openai", 300) for static access

describe('OpenAI provider tools', () => {
  const [gen, edit] = TOOLS;
  const genSchema = gen.inputSchema as any;
  const editSchema = edit.inputSchema as any;

  it('generate_image should mention OpenAI in description', () => {
    expect(gen.description).toContain('OpenAI');
  });

  it('generate_image should expose size (OpenAI)', () => {
    expect(genSchema.properties.size).toBeDefined();
  });

  it('generate_image should expose quality (OpenAI)', () => {
    expect(genSchema.properties.quality).toBeDefined();
  });

  it('generate_image should expose n (OpenAI)', () => {
    expect(genSchema.properties.n).toBeDefined();
  });

  it('generate_image should NOT expose aspect_ratio (Gemini-only)', () => {
    expect(genSchema.properties.aspect_ratio).toBeUndefined();
  });

  it('edit_image should mention OpenAI in description', () => {
    expect(edit.description).toContain('OpenAI');
  });

  it('edit_image should expose mask (OpenAI)', () => {
    expect(editSchema.properties.mask).toBeDefined();
  });

  it('edit_image should expose size (OpenAI)', () => {
    expect(editSchema.properties.size).toBeDefined();
  });

  it('edit_image should NOT expose aspect_ratio (Gemini-only)', () => {
    expect(editSchema.properties.aspect_ratio).toBeUndefined();
  });
});

describe('Gemini provider tools', () => {
  const tools = createTools('gemini', 300);
  const [gen, edit] = tools;
  const genSchema = gen.inputSchema as any;
  const editSchema = edit.inputSchema as any;

  it('generate_image should mention Gemini in description', () => {
    expect(gen.description).toContain('Gemini');
  });

  it('generate_image should expose aspect_ratio (Gemini)', () => {
    expect(genSchema.properties.aspect_ratio).toBeDefined();
  });

  it('generate_image should NOT expose size (OpenAI-only)', () => {
    expect(genSchema.properties.size).toBeUndefined();
  });

  it('generate_image should NOT expose quality (OpenAI-only)', () => {
    expect(genSchema.properties.quality).toBeUndefined();
  });

  it('generate_image should NOT expose n (OpenAI-only)', () => {
    expect(genSchema.properties.n).toBeUndefined();
  });

  it('edit_image should mention Gemini in description', () => {
    expect(edit.description).toContain('Gemini');
  });

  it('edit_image should expose aspect_ratio (Gemini)', () => {
    expect(editSchema.properties.aspect_ratio).toBeDefined();
  });

  it('edit_image should NOT expose mask (OpenAI-only)', () => {
    expect(editSchema.properties.mask).toBeUndefined();
  });

  it('edit_image should NOT expose size (OpenAI-only)', () => {
    expect(editSchema.properties.size).toBeUndefined();
  });
});

describe('Provider-agnostic', () => {
  it('should always have prompt in generate_image', () => {
    for (const p of ['openai', 'gemini'] as const) {
      const [gen] = createTools(p, 300);
      const schema = gen.inputSchema as any;
      expect(schema.required).toContain('prompt');
      expect(schema.properties.prompt).toBeDefined();
    }
  });

  it('should always have image + prompt in edit_image', () => {
    for (const p of ['openai', 'gemini'] as const) {
      const [, edit] = createTools(p, 300);
      const schema = edit.inputSchema as any;
      expect(schema.required).toContain('image');
      expect(schema.required).toContain('prompt');
    }
  });

  it('should always have timeout', () => {
    for (const p of ['openai', 'gemini'] as const) {
      const [gen, edit] = createTools(p, 300);
      expect((gen.inputSchema as any).properties.timeout).toBeDefined();
      expect((edit.inputSchema as any).properties.timeout).toBeDefined();
    }
  });

  it('timeout description should reflect custom value', () => {
    const [gen] = createTools('openai', 600);
    const desc = (gen.inputSchema as any).properties.timeout.description;
    expect(desc).toContain('600');
  });

  it('should never expose model or response_format', () => {
    for (const p of ['openai', 'gemini'] as const) {
      const [gen, edit] = createTools(p, 300);
      expect((gen.inputSchema as any).properties.model).toBeUndefined();
      expect((gen.inputSchema as any).properties.response_format).toBeUndefined();
      expect((edit.inputSchema as any).properties.model).toBeUndefined();
      expect((edit.inputSchema as any).properties.response_format).toBeUndefined();
    }
  });
});

describe('getToolByName', () => {
  it('should return tool for valid names', () => {
    expect(getToolByName('generate_image')?.name).toBe('generate_image');
    expect(getToolByName('edit_image')?.name).toBe('edit_image');
  });

  it('should return undefined for invalid name', () => {
    expect(getToolByName('invalid_tool')).toBeUndefined();
    expect(getToolByName('')).toBeUndefined();
  });
});

describe('isValidToolName', () => {
  it('should return true for valid tool names', () => {
    expect(isValidToolName('generate_image')).toBe(true);
    expect(isValidToolName('edit_image')).toBe(true);
  });

  it('should return false for invalid tool names', () => {
    expect(isValidToolName('invalid')).toBe(false);
    expect(isValidToolName('')).toBe(false);
  });
});
