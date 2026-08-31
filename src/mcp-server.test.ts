import { describe, it, expect, afterEach } from 'vitest';
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

  it('still advertises the tools when no credentials are configured', async () => {
    const { server } = createMcpServer(configWith({}));
    const handler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    const result = await handler({ method: 'tools/list', params: {} }, { signal: new AbortController().signal });
    expect(result.tools.map((tool: { name: string }) => tool.name)).toContain('generate_image');
  });

  it('explains the missing API key when a tool is called unconfigured', async () => {
    const { server } = createMcpServer(configWith({}));
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const result = await handler(
      { method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'a cat' } } },
      { signal: new AbortController().signal }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OPENAI_API_KEY');
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

describe('upload_image tool', () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  afterEach(() => {
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const { server } = createMcpServer(configWith({ OPENAI_API_KEY: 'sk-test-key' }));
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    return handler(
      { method: 'tools/call', params: { name, arguments: args } },
      { signal: new AbortController().signal }
    );
  };

  it('is hidden when the deployment has nowhere to store images', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { tools } = createMcpServer(configWith({ OPENAI_API_KEY: 'sk-test-key' }));
    expect(tools.map((tool) => tool.name)).not.toContain('upload_image');
  });

  it('is advertised first once storage is connected', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'tok';
    const { tools } = createMcpServer(configWith({ OPENAI_API_KEY: 'sk-test-key' }));
    expect(tools[0].name).toBe('upload_image');
  });

  it('explains the missing configuration instead of throwing', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const result = await callTool('upload_image', { image: 'aGVsbG8=' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('BLOB_READ_WRITE_TOKEN');
  });

  it('hands a URL straight back instead of storing it again', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'tok';
    const result = await callTool('upload_image', { image: 'https://example.com/photo.png' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).url).toBe('https://example.com/photo.png');
  });

  it('rejects a base64 string that arrived empty or truncated to nothing', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'tok';
    const result = await callTool('upload_image', { image: '   ' });
    expect(result.isError).toBe(true);
  });
});
