import { describe, it, expect } from 'vitest';
import {
  GENERATE_IMAGE_TOOL,
  TOOLS,
  getToolByName,
  isValidToolName,
} from './tools.js';

describe('GENERATE_IMAGE_TOOL', () => {
  it('should have correct name', () => {
    expect(GENERATE_IMAGE_TOOL.name).toBe('generate_image');
  });

  it('should have description', () => {
    expect(GENERATE_IMAGE_TOOL.description).toBeTruthy();
    expect(GENERATE_IMAGE_TOOL.description).toContain('image');
  });

  it('should have inputSchema with required prompt', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('prompt');
  });

  it('should define prompt property', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.prompt).toBeDefined();
    expect(schema.properties.prompt.type).toBe('string');
  });

  it('should define model property with enum', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.model).toBeDefined();
    expect(schema.properties.model.description).toContain('gpt-image-2');
    expect(schema.properties.model.description).toContain('doubao-seedream');
    expect(schema.properties.model.examples).toContain('dall-e-2');
    expect(schema.properties.model.examples).toContain('gemini-3-pro-image-preview');
  });

  it('should define size property', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.size).toBeDefined();
    expect(schema.properties.size.description).toContain('1024x1024');
    expect(schema.properties.size.description).toContain('1536x1024');
  });

  it('should define quality property', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.quality).toBeDefined();
    expect(schema.properties.quality.enum).toContain('standard');
    expect(schema.properties.quality.enum).toContain('hd');
  });

  it('should define response_format property', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.response_format).toBeDefined();
    expect(schema.properties.response_format.enum).toContain('url');
    expect(schema.properties.response_format.enum).toContain('base64');
    expect(schema.properties.response_format.enum).toContain('auto');
  });

  it('should define timeout property with default 120', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.timeout).toBeDefined();
    expect(schema.properties.timeout.type).toBe('number');
    expect(schema.properties.timeout.default).toBe(120);
  });
});

describe('TOOLS', () => {
  it('should contain generate_image tool', () => {
    expect(TOOLS).toContainEqual(GENERATE_IMAGE_TOOL);
  });

  it('should have at least one tool', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getToolByName', () => {
  it('should return tool for valid name', () => {
    const tool = getToolByName('generate_image');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('generate_image');
  });

  it('should return undefined for invalid name', () => {
    expect(getToolByName('invalid_tool')).toBeUndefined();
    expect(getToolByName('')).toBeUndefined();
  });
});

describe('isValidToolName', () => {
  it('should return true for valid tool names', () => {
    expect(isValidToolName('generate_image')).toBe(true);
  });

  it('should return false for invalid tool names', () => {
    expect(isValidToolName('invalid')).toBe(false);
    expect(isValidToolName('')).toBe(false);
  });
});
