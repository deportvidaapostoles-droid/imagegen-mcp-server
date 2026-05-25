import { describe, expect, it } from 'vitest';
import {
  getCliHelpText,
  getServerRuntimeConfig,
  loadDotEnv,
} from './config.js';

describe('getServerRuntimeConfig', () => {
  it('should apply defaults', () => {
    const config = getServerRuntimeConfig([], {});

    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-image-1');
    expect(config.transportMode).toBe('stdio');
    expect(config.stdioLogsEnabled).toBe(false);
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(3000);
    expect(config.timeout).toBe(300);
  });

  it('should read provider and model from env', () => {
    const config = getServerRuntimeConfig([], {
      IMAGEGEN_PROVIDER: 'gemini',
      IMAGEGEN_MODEL: 'gemini-2.5-flash-image',
    });

    expect(config.provider).toBe('gemini');
    expect(config.model).toBe('gemini-2.5-flash-image');
  });

  it('should prioritize CLI over env', () => {
    const config = getServerRuntimeConfig(
      ['--provider', 'gemini', '--model', 'gemini-2.0-flash-exp'],
      { IMAGEGEN_PROVIDER: 'openai', IMAGEGEN_MODEL: 'gpt-image-2' },
    );

    expect(config.provider).toBe('gemini');
    expect(config.model).toBe('gemini-2.0-flash-exp');
  });

  it('should fall back for invalid provider', () => {
    const config = getServerRuntimeConfig([], {
      IMAGEGEN_PROVIDER: 'invalid',
    });

    expect(config.provider).toBe('openai');
    expect(config.warnings.some((w) => w.includes('IMAGEGEN_PROVIDER'))).toBe(true);
  });

  it('should fall back for invalid port and transport', () => {
    const config = getServerRuntimeConfig([], {
      MCP_TRANSPORT: 'invalid',
      MCP_PORT: 'abc',
    });

    expect(config.transportMode).toBe('stdio');
    expect(config.port).toBe(3000);
    expect(config.warnings.some((w) => w.includes('MCP_TRANSPORT'))).toBe(true);
    expect(config.warnings.some((w) => w.includes('MCP_PORT'))).toBe(true);
  });

  it('should enable stdioLogsEnabled via env var', () => {
    const config = getServerRuntimeConfig([], { MCP_STDIO_LOGS: 'true' });
    expect(config.stdioLogsEnabled).toBe(true);
  });

  it('should enable stdioLogsEnabled via CLI flag without value', () => {
    const config = getServerRuntimeConfig(['--mcp-stdio-logs'], {});
    expect(config.stdioLogsEnabled).toBe(true);
  });

  it('should disable stdioLogsEnabled when set to false', () => {
    const config = getServerRuntimeConfig(['--mcp-stdio-logs=false'], {});
    expect(config.stdioLogsEnabled).toBe(false);
  });

  it('should read OpenAI config from env', () => {
    const config = getServerRuntimeConfig([], {
      OPENAI_API_KEY: 'sk-test123',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
    });

    expect(config.openaiApiKey).toBe('sk-test123');
    expect(config.openaiBaseUrl).toBe('https://proxy.example.com/v1');
  });

  it('should read Gemini config from env', () => {
    const config = getServerRuntimeConfig([], {
      GEMINI_API_KEY: 'gemini-test123',
      GEMINI_BASE_URL: 'https://gemini-proxy.example.com',
    });

    expect(config.geminiApiKey).toBe('gemini-test123');
    expect(config.geminiBaseUrl).toBe('https://gemini-proxy.example.com');
  });
});

describe('getCliHelpText', () => {
  it('should describe CLI usage', () => {
    const helpText = getCliHelpText();

    expect(helpText).toContain('--provider');
    expect(helpText).toContain('--model');
    expect(helpText).toContain('--openai-api-key');
    expect(helpText).toContain('--gemini-api-key');
    expect(helpText).toContain('IMAGEGEN_PROVIDER');
    expect(helpText).toContain('IMAGEGEN_MODEL');
  });
});
