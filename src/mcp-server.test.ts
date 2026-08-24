import { describe, it, expect } from 'vitest';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getServerRuntimeConfig } from './config.js';
import { createMcpServer } from './mcp-server.js';
import { healthPayload, readJsonBody } from './http-transport.js';
import { Readable } from 'node:stream';

function configWith(env: Record<string, string>) {
  return getServerRuntimeConfig([], env as NodeJS.ProcessEnv);
}

describe('createMcpServer', () => {
  it('exposes the sync and async tools when the provider is configured', () => {
    const { tools } = createMcpServer(configWith({ OPENAI_API_KEY: 'sk-test-key' }));
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'edit_image',
      'generate_image',
      'get_task',
      'submit_task',
    ]);
  });

  it('exposes only async tools when IMAGEGEN_ASYNC_ONLY is set', () => {
    const { tools } = createMcpServer(
      configWith({ OPENAI_API_KEY: 'sk-test-key', IMAGEGEN_ASYNC_ONLY: 'true' })
    );
    expect(tools.map((tool) => tool.name).sort()).toEqual(['get_task', 'submit_task']);
  });

  it('reports the gemini tool set for the gemini provider', () => {
    const { tools } = createMcpServer(
      configWith({ IMAGEGEN_PROVIDER: 'gemini', GEMINI_API_KEY: 'gm-test-key' })
    );
    const generate = tools.find((tool) => tool.name === 'generate_image');
    expect(Object.keys(generate!.inputSchema.properties ?? {})).toContain('aspect_ratio');
  });

  it('hides tools when no credentials are configured', async () => {
    const { server } = createMcpServer(configWith({}));
    const handler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    const result = await handler({ method: 'tools/list', params: {} }, { signal: new AbortController().signal });
    expect(result.tools).toEqual([]);
  });

  it('returns a structured error for an unknown tool', async () => {
    const { server } = createMcpServer(configWith({ OPENAI_API_KEY: 'sk-test-key' }));
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const result = await handler(
      { method: 'tools/call', params: { name: 'not_a_tool', arguments: {} } },
      { signal: new AbortController().signal }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('validates submit_task arguments', async () => {
    const { server } = createMcpServer(configWith({ OPENAI_API_KEY: 'sk-test-key' }));
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const result = await handler(
      { method: 'tools/call', params: { name: 'submit_task', arguments: { kind: 'edit', prompt: 'hi' } } },
      { signal: new AbortController().signal }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('images array is required');
  });
});

describe('http transport helpers', () => {
  it('builds a health payload', () => {
    const payload = healthPayload(configWith({ OPENAI_API_KEY: 'sk-test-key' }));
    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('imagegen-mcp-server');
    expect(payload.configured).toBe(true);
  });

  it('reuses a body already parsed by the platform', async () => {
    const req = Object.assign(Readable.from([]), { body: { jsonrpc: '2.0' } });
    await expect(readJsonBody(req as any)).resolves.toEqual({ jsonrpc: '2.0' });
  });

  it('parses a streamed JSON body', async () => {
    const req = Readable.from([Buffer.from('{"jsonrpc":"2.0","id":1}')]);
    await expect(readJsonBody(req as any)).resolves.toEqual({ jsonrpc: '2.0', id: 1 });
  });

  it('returns undefined for an empty body', async () => {
    const req = Readable.from([]);
    await expect(readJsonBody(req as any)).resolves.toBeUndefined();
  });
});
