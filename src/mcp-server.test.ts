import { describe, it, expect, afterEach } from 'vitest';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getServerRuntimeConfig } from './config.js';
import { buildInstructions, createMcpServer } from './mcp-server.js';
import { handleMcpRequest, healthPayload, readJsonBody } from './http-transport.js';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

function configWith(env: Record<string, string>) {
  return getServerRuntimeConfig([], env as NodeJS.ProcessEnv);
}

describe('buildInstructions', () => {
  it('names the deployment upload page so the model can link to it', () => {
    const instructions = buildInstructions('https://example.vercel.app/u');
    expect(instructions).toContain('https://example.vercel.app/u');
    expect(instructions).toMatch(/do not read the file|Do not read an image file/i);
  });

  it('falls back to naming the route when the transport does not know the origin', () => {
    expect(buildInstructions()).toContain("the server's /u page");
  });

  it('reaches a real client through the HTTP transport, pointing at this deployment', async () => {
    const config = configWith({ OPENAI_API_KEY: 'sk-test-key' });
    const httpServer = createServer((req, res) => {
      void handleMcpRequest(req as never, res, config, { log: () => {} });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });
      const raw = await response.text();
      // The transport answers as SSE; the JSON-RPC message rides on a data: line.
      const line = raw.split('\n').find((entry) => entry.startsWith('data:')) ?? raw;
      const message = JSON.parse(line.replace(/^data:\s*/, ''));
      expect(message.result.instructions).toContain(`http://127.0.0.1:${port}/u`);
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});

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
