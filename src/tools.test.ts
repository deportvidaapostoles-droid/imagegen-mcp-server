import { describe, it, expect } from 'vitest';
import {
  GENERATE_IMAGE_TOOL,
  EDIT_IMAGE_TOOL,
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

  it('should NOT have model property (model is from env)', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.model).toBeUndefined();
  });

  it('should NOT have response_format property (always base64)', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.response_format).toBeUndefined();
  });

  it('should define size property', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.size).toBeDefined();
  });

  it('should define quality property', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.quality).toBeDefined();
    expect(schema.properties.quality.enum).toContain('standard');
    expect(schema.properties.quality.enum).toContain('hd');
  });

  it('should define aspect_ratio property', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.aspect_ratio).toBeDefined();
    expect(schema.properties.aspect_ratio.enum).toContain('1:1');
    expect(schema.properties.aspect_ratio.enum).toContain('16:9');
  });

  it('should define timeout property without hardcoded default', () => {
    const schema = GENERATE_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.timeout).toBeDefined();
    expect(schema.properties.timeout.type).toBe('number');
    // timeout default comes from IMAGEGEN_TIMEOUT env var, not hardcoded in schema
    expect(schema.properties.timeout.default).toBeUndefined();
  });
});

describe('EDIT_IMAGE_TOOL', () => {
  it('should have correct name', () => {
    expect(EDIT_IMAGE_TOOL.name).toBe('edit_image');
  });

  it('should have description', () => {
    expect(EDIT_IMAGE_TOOL.description).toBeTruthy();
    expect(EDIT_IMAGE_TOOL.description).toContain('edit');
  });

  it('should require image and prompt', () => {
    const schema = EDIT_IMAGE_TOOL.inputSchema as any;
    expect(schema.required).toContain('image');
    expect(schema.required).toContain('prompt');
  });

  it('should define image property', () => {
    const schema = EDIT_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.image).toBeDefined();
    expect(schema.properties.image.type).toBe('string');
  });

  it('should define mask property (optional)', () => {
    const schema = EDIT_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.mask).toBeDefined();
    expect(schema.properties.mask.type).toBe('string');
  });

  it('should NOT have model property', () => {
    const schema = EDIT_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.model).toBeUndefined();
  });

  it('should NOT have response_format property', () => {
    const schema = EDIT_IMAGE_TOOL.inputSchema as any;
    expect(schema.properties.response_format).toBeUndefined();
  });
});

describe('TOOLS', () => {
  it('should contain both tools', () => {
    expect(TOOLS).toContainEqual(GENERATE_IMAGE_TOOL);
    expect(TOOLS).toContainEqual(EDIT_IMAGE_TOOL);
  });

  it('should have exactly 2 tools', () => {
    expect(TOOLS.length).toBe(2);
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
