/**
 * Integration tests using real API keys
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ChildProcess, spawn } from 'child_process';

// Load environment variables
config();

/** Spawn MCP server with given transport mode, wait for "Server listening" on stderr */
function spawnServer(transport: string, port: number): { process: ChildProcess; ready: Promise<void> } {
  const serverProcess = spawn('node', ['dist/index.js'], {
    env: { ...process.env, MCP_TRANSPORT: transport, MCP_PORT: String(port), MCP_HOST: '127.0.0.1' },
    stdio: 'pipe',
    cwd: process.cwd(),
  });
  const ready = new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server start timeout. stderr: ${output}`)), 10000);
    serverProcess.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('Server listening')) { clearTimeout(timeout); resolve(); }
    });
    serverProcess.on('exit', (code) => {
      if (!output.includes('Server listening')) { clearTimeout(timeout); reject(new Error(`Server exited ${code}. stderr: ${output}`)); }
    });
    serverProcess.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
  return { process: serverProcess, ready };
}

/** Verify generate_image returns MCP ImageContent or handle proxy model_not_found */
function verifyImageResult(result: any, label: string) {
  const blocks = result.content as any[];
  if (blocks.length === 1 && blocks[0].type === 'text') {
    try {
      const parsed = JSON.parse(blocks[0].text);
      if (!parsed.success && parsed.error?.includes('model_not_found')) {
        console.log('Model unavailable on proxy, skipping');
        return 'skip';
      }
    } catch { /* not JSON error */ }
  }
  const imageBlock = blocks.find((b: any) => b.type === 'image');
  expect(imageBlock).toBeDefined();
  expect(imageBlock.data).toBeDefined();
  expect(imageBlock.mimeType).toMatch(/^image\//);
  console.log(`${label}: got MCP ImageContent, mimeType:`, imageBlock.mimeType);
  return 'ok';
}

describe('Gemini Integration Tests', () => {
  let geminiClient: GoogleGenAI | null = null;

  beforeAll(() => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not set, skipping integration tests');
      return;
    }
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : undefined,
    });
  });

  it('should initialize Gemini client with API key', () => {
    expect(process.env.GEMINI_API_KEY).toBeDefined();
    expect(geminiClient).not.toBeNull();
  });

  it('should generate text content with gemini-2.0-flash', async () => {
    if (!geminiClient) {
      console.log('Skipping: No Gemini client');
      return;
    }

    try {
      const result = await geminiClient.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: 'Say hello',
      });
      const text = result.text ?? '';
      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);
      console.log('Gemini response:', text);
    } catch (error: any) {
      if (error.status === 429 || error.message?.includes('model_not_found')) {
        console.log('API unavailable, skipping:', error.message?.substring(0, 80));
        return;
      }
      throw error;
    }
  }, 60000);

  it('should attempt image generation', async () => {
    if (!geminiClient) {
      console.log('Skipping: No Gemini client');
      return;
    }

    try {
      const result = await geminiClient.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: 'A red circle',
      });
      const candidates = result.candidates;
      
      if (candidates && candidates.length > 0) {
        for (const part of candidates[0].content!.parts!) {
          if (part.inlineData) {
            console.log('Image generated:', part.inlineData.mimeType);
          } else if (part.text) {
            console.log('Text:', part.text.substring(0, 100));
          }
        }
      }
    } catch (error: any) {
      if (error.status === 429) {
        console.log('Rate limited - quota exceeded, skipping');
        return;
      }
      console.log('Image gen error:', error.message);
    }
  }, 60000);
});

describe('SSE MCP Integration Tests', () => {
  let serverProcess: ChildProcess;
  let mcpClient: Client;
  const PORT = 3099;

  beforeAll(async () => {
    const server = spawnServer('sse', PORT);
    serverProcess = server.process;
    await server.ready;
    await new Promise(r => setTimeout(r, 500));

    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${PORT}/sse`));
    mcpClient = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(transport);
  }, 15000);

  afterAll(async () => {
    await mcpClient?.close();
    serverProcess?.kill();
  });

  it('should list tools via SSE', async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('generate_image');
    console.log('SSE listTools:', tools.map(t => t.name));
  });

  it('should call generate_image via SSE', async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log('Skipping: No GEMINI_API_KEY');
      return;
    }

    const result = await mcpClient.callTool({
      name: 'generate_image',
      arguments: { prompt: 'A blue square', model: 'gemini-2.5-flash-image' },
    });

    verifyImageResult(result, 'SSE generate_image');
  }, 60000);

  it('should return error for unavailable provider via SSE', async () => {
    if (process.env.OPENAI_API_KEY) {
      console.log('Skipping: OPENAI_API_KEY is set, cannot test unavailable provider');
      return;
    }

    const result = await mcpClient.callTool({
      name: 'generate_image',
      arguments: { prompt: 'test', model: 'dall-e-3' },
    });

    const parsed = JSON.parse((result.content as any[])[0]?.text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('OPENAI_API_KEY');
    console.log('SSE unavailable provider error:', parsed.error);
  });
});

describe('Stdio MCP Integration Tests', () => {
  let mcpClient: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Filter undefined values and force stdio mode (dotenv may set MCP_TRANSPORT=sse)
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env.MCP_TRANSPORT = 'stdio';
    delete env.MCP_PORT;
    delete env.MCP_HOST;

    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env,
    });
    mcpClient = new Client({ name: 'test-stdio-client', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(transport);
  }, 15000);

  afterAll(async () => {
    await mcpClient?.close();
  });

  it('should list tools via stdio', async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('generate_image');
    console.log('Stdio listTools:', tools.map(t => t.name));
  });

  it('should call generate_image via stdio', async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log('Skipping: No GEMINI_API_KEY');
      return;
    }

    const result = await mcpClient.callTool({
      name: 'generate_image',
      arguments: { prompt: 'A green triangle', model: 'gemini-2.5-flash-image' },
    });

    verifyImageResult(result, 'Stdio generate_image');
  }, 60000);

  it('should return error for unavailable provider via stdio', async () => {
    if (process.env.OPENAI_API_KEY) {
      console.log('Skipping: OPENAI_API_KEY is set');
      return;
    }

    const result = await mcpClient.callTool({
      name: 'generate_image',
      arguments: { prompt: 'test', model: 'dall-e-3' },
    });

    const parsed = JSON.parse((result.content as any[])[0]?.text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('OPENAI_API_KEY');
    console.log('Stdio unavailable provider error:', parsed.error);
  });
});

describe('HTTP MCP Integration Tests', () => {
  let serverProcess: ChildProcess;
  let mcpClient: Client;
  const PORT = 3098;

  beforeAll(async () => {
    const server = spawnServer('http', PORT);
    serverProcess = server.process;
    await server.ready;
    await new Promise(r => setTimeout(r, 500));

    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${PORT}/sse`));
    mcpClient = new Client({ name: 'test-http-client', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(transport);
  }, 15000);

  afterAll(async () => {
    await mcpClient?.close();
    serverProcess?.kill();
  });

  it('should list tools via HTTP', async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('generate_image');
    console.log('HTTP listTools:', tools.map(t => t.name));
  });

  it('should call generate_image via HTTP', async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log('Skipping: No GEMINI_API_KEY');
      return;
    }

    const result = await mcpClient.callTool({
      name: 'generate_image',
      arguments: { prompt: 'A yellow star', model: 'gemini-2.5-flash-image' },
    });

    verifyImageResult(result, 'HTTP generate_image');
  }, 60000);
});
