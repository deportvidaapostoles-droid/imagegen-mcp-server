import { describe, expect, it } from 'vitest';
import {
  getCliHelpText,
  getServerRuntimeConfig,
  parseCliArgs,
  resolveConfig,
} from './config.js';

describe('parseCliArgs', () => {
  it('should parse key value pairs and equals syntax', () => {
    const parsed = parseCliArgs([
      '--openai-api-key', 'sk-test',
      '--default-model=gpt-image-2',
      '--mcp-port', '4000',
    ]);

    expect(parsed.values.OPENAI_API_KEY).toBe('sk-test');
    expect(parsed.values.DEFAULT_MODEL).toBe('gpt-image-2');
    expect(parsed.values.MCP_PORT).toBe('4000');
  });

  it('should detect help flag', () => {
    const parsed = parseCliArgs(['--help']);
    expect(parsed.helpRequested).toBe(true);
  });

  it('should warn on unknown options', () => {
    const parsed = parseCliArgs(['--unknown-option', 'value']);
    expect(parsed.warnings[0]).toContain('Unknown CLI option');
  });
});

describe('resolveConfig', () => {
  it('should prioritize CLI values over environment values', () => {
    const resolved = resolveConfig(
      ['--default-model', 'gpt-image-2'],
      { DEFAULT_MODEL: 'gemini-2.5-flash-image' },
    );

    expect(resolved.values.DEFAULT_MODEL).toBe('gpt-image-2');
  });

  it('should ignore placeholder API keys', () => {
    const resolved = resolveConfig([], {
      GEMINI_API_KEY: 'your-gemini-api-key',
      OPENAI_API_KEY: 'sk-your-openai-api-key',
    });

    expect(resolved.values.GEMINI_API_KEY).toBeUndefined();
    expect(resolved.values.OPENAI_API_KEY).toBeUndefined();
    expect(resolved.warnings).toHaveLength(2);
  });
});

describe('getServerRuntimeConfig', () => {
  it('should apply defaults', () => {
    const config = getServerRuntimeConfig([], {});

    expect(config.defaultModel).toBe('gemini-2.5-flash-image');
    expect(config.transportMode).toBe('stdio');
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(3000);
  });

  it('should fall back for invalid port and transport', () => {
    const config = getServerRuntimeConfig([], {
      MCP_TRANSPORT: 'invalid',
      MCP_PORT: 'abc',
    });

    expect(config.transportMode).toBe('stdio');
    expect(config.port).toBe(3000);
    expect(config.warnings.some((warning) => warning.includes('MCP_TRANSPORT'))).toBe(true);
    expect(config.warnings.some((warning) => warning.includes('MCP_PORT'))).toBe(true);
  });
});

describe('getCliHelpText', () => {
  it('should describe CLI usage', () => {
    const helpText = getCliHelpText();

    expect(helpText).toContain('--openai-api-key');
    expect(helpText).toContain('--gemini-api-key');
    expect(helpText).toContain('CLI > environment > defaults');
  });
});
