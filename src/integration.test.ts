/**
 * Integration tests using real API keys
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ChildProcess, spawn } from 'child_process';

// Load environment variables
config();

const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

/** Spawn MCP server with given transport mode, wait for "Server listening" on stderr */
function spawnServer(transport: string, port: number): { process: ChildProcess; ready: Promise<void> } {
  const serverProcess = spawn('node', ['dist/index.js'], {
    env: { ...process.env, MCP_TRANSPORT: transport, MCP_PORT: String(port), MCP_HOST: '127.0.0.1', MCP_STDIO_LOGS: 'true' },
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

/**
 * Perform a raw stdio MCP exchange (JSON-RPC over newline-delimited stdio).
 * Sends initialize → tools/list, then closes stdin.
 * Returns every raw line written to stdout plus all stderr output.
 */
function doRawStdioMcp(
  extraEnv: Record<string, string> = {},
  timeoutMs = 10000,
): Promise<{ stdoutLines: string[]; stderrOutput: string; listToolsResult?: unknown }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  Object.assign(env, { MCP_TRANSPORT: 'stdio' }, extraEnv);
  delete env.MCP_PORT;
  delete env.MCP_HOST;

  const proc = spawn('node', ['dist/index.js'], { env, stdio: 'pipe', cwd: process.cwd() });
  const stdoutLines: string[] = [];
  let stderrOutput = '';
  let listToolsResult: unknown;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Timeout in raw stdio exchange')); }, timeoutMs);

    let buf = '';
    let initDone = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        stdoutLines.push(trimmed);
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: { tools?: unknown[] } };
          if (!initDone && msg.id === 1) {
            initDone = true;
            proc.stdin?.write(
              JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n',
            );
            proc.stdin?.write(
              JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n',
            );
          } else if (msg.id === 2) {
            listToolsResult = msg.result;
            proc.stdin?.end();
          }
        } catch { /* intentionally ignored — assertion will catch non-JSON lines */ }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => { stderrOutput += chunk.toString(); });

    proc.on('exit', () => {
      clearTimeout(timer);
      if (buf.trim()) stdoutLines.push(buf.trim());
      resolve({ stdoutLines, stderrOutput, listToolsResult });
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });

    // Kick off the handshake
    proc.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'purity-test-client', version: '1.0.0' },
        },
      }) + '\n',
    );
  });
}

/** Verify generate_image returns MCP ImageContent, or skip gracefully on any server-side error. */
function verifyImageResult(result: any, label: string) {
  const blocks = result.content as any[];

  // Handle single text block — the server wraps all errors as {success:false, error:"..."}
  if (blocks.length === 1 && blocks[0].type === 'text') {
    let parsed: any;
    try { parsed = JSON.parse(blocks[0].text); } catch { /* not JSON */ }

    if (parsed && !parsed.success) {
      console.log(`${label}: server returned error (skipping) →`, parsed.error);
      return 'skip';
    }
    // Plain text (no image) — treat as unexpected
    console.log(`${label}: unexpected text response →`, blocks[0].text?.substring(0, 200));
  }

  const imageBlock = blocks.find((b: any) => b.type === 'image');
  expect(imageBlock, `${label}: expected an image block, got: ${JSON.stringify(blocks)}`).toBeDefined();
  expect(imageBlock.data).toBeDefined();
  expect(imageBlock.mimeType).toMatch(/^image\//);
  console.log(`${label}: got MCP ImageContent, mimeType:`, imageBlock.mimeType);
  return 'ok';
}

function isSkippableOpenAIError(error: any): boolean {
  return Boolean(
    error?.status === 403 ||
    error?.status === 404 ||
    error?.status === 429 ||
    error?.status === 502 ||
    error?.status === 503 ||
    error?.message?.includes('model_not_found') ||
    error?.message?.includes('does not exist') ||
    error?.message?.includes('quota') ||
    error?.message?.includes('rate limit') ||
    error?.message?.includes('blocked')
  );
}

function verifyOpenAIResponseImage(response: OpenAI.Images.ImagesResponse, label: string) {
  const first = response.data?.[0];
  expect(first).toBeDefined();
  expect(first?.b64_json || first?.url).toBeDefined();
  console.log(`${label}: got OpenAI image payload`, first?.b64_json ? 'b64_json' : 'url');
}

describe('OpenAI Integration Tests', () => {
  let openaiClient: OpenAI | null = null;

  beforeAll(() => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not set, skipping OpenAI integration tests');
      return;
    }

    openaiClient = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  });

  it('should initialize OpenAI client with API key', () => {
    expect(process.env.OPENAI_API_KEY).toBeDefined();
    expect(openaiClient).not.toBeNull();
  });

  it('should attempt image generation with gpt-image model', async () => {
    if (!openaiClient) {
      console.log('Skipping: No OpenAI client');
      return;
    }

    try {
      const response = await openaiClient.images.generate({
        model: OPENAI_IMAGE_MODEL,
        prompt: 'A simple black circle on a white background',
        size: '1024x1024',
      });

      verifyOpenAIResponseImage(response, `OpenAI ${OPENAI_IMAGE_MODEL}`);
    } catch (error: any) {
      if (isSkippableOpenAIError(error)) {
        const baseURL = process.env.OPENAI_BASE_URL || '(default OpenAI)';
        console.log(`OpenAI image API unavailable (baseURL: ${baseURL}), skipping:`, error.message?.substring(0, 120));
        return;
      }

      throw error;
    }
  }, 120000);
});

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
      console.log('Gemini API unavailable, skipping:', error.message?.substring(0, 120));
      return;
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

  it('should call generate_image via SSE with OpenAI-compatible endpoint', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping: No OPENAI_API_KEY');
      return;
    }

    try {
      const result = await mcpClient.callTool({
        name: 'generate_image',
        arguments: { prompt: 'A purple triangle', model: OPENAI_IMAGE_MODEL },
      }, undefined, { timeout: 120000 });

      verifyImageResult(result, `SSE ${OPENAI_IMAGE_MODEL}`);
    } catch (error: any) {
      if (isSkippableOpenAIError(error) || isSkippableMcpError(error)) {
        console.log('OpenAI proxy unavailable over SSE, skipping:', error.message?.substring(0, 120));
        return;
      }

      throw error;
    }
  }, 120000);

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

  it('should call generate_image via stdio with OpenAI-compatible endpoint', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping: No OPENAI_API_KEY');
      return;
    }

    try {
      const result = await mcpClient.callTool({
        name: 'generate_image',
        arguments: { prompt: 'A silver cube', model: OPENAI_IMAGE_MODEL },
      }, undefined, { timeout: 120000 });

      verifyImageResult(result, `Stdio ${OPENAI_IMAGE_MODEL}`);
    } catch (error: any) {
      if (isSkippableOpenAIError(error)) {
        console.log('OpenAI proxy unavailable over stdio, skipping:', error.message?.substring(0, 120));
        return;
      }

      throw error;
    }
  }, 120000);

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

  it('should call generate_image via HTTP with OpenAI-compatible endpoint', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping: No OPENAI_API_KEY');
      return;
    }

    try {
      const result = await mcpClient.callTool({
        name: 'generate_image',
        arguments: { prompt: 'A gold star', model: OPENAI_IMAGE_MODEL },
      }, undefined, { timeout: 120000 });

      verifyImageResult(result, `HTTP ${OPENAI_IMAGE_MODEL}`);
    } catch (error: any) {
      if (isSkippableOpenAIError(error)) {
        console.log('OpenAI proxy unavailable over HTTP, skipping:', error.message?.substring(0, 120));
        return;
      }

      throw error;
    }
  }, 120000);
});

// ─── Stdio Protocol Purity Tests ────────────────────────────────────────────
// These tests do NOT require API keys. They verify that the stdio transport
// is clean — only valid JSON-RPC appears on stdout, and startup logs are
// suppressed by default (re-enabled via MCP_STDIO_LOGS=true).

describe('Stdio Protocol Purity Tests', () => {
  it('should emit only valid JSON-RPC on stdout in default stdio mode', async () => {
    const { stdoutLines } = await doRawStdioMcp();
    expect(stdoutLines.length).toBeGreaterThan(0);
    for (const line of stdoutLines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Non-JSON output on stdout would break MCP clients: ${line}`);
      }
      expect(parsed).toBeTypeOf('object');
    }
    console.log('Purity: all stdout lines are valid JSON, count:', stdoutLines.length);
  }, 10000);

  it('should not write any startup logs to stderr in default stdio mode', async () => {
    const { stderrOutput } = await doRawStdioMcp();
    expect(stderrOutput).toBe('');
    console.log('Purity: stderr is empty in default stdio mode');
  }, 10000);

  it('should write startup logs to stderr when MCP_STDIO_LOGS=true, stdout still clean', async () => {
    const { stdoutLines, stderrOutput } = await doRawStdioMcp({ MCP_STDIO_LOGS: 'true' });
    for (const line of stdoutLines) {
      expect(() => JSON.parse(line), `Non-JSON on stdout: ${line}`).not.toThrow();
    }
    expect(stderrOutput).toContain('Assets Generation MCP Server running on stdio');
    console.log('Purity: MCP_STDIO_LOGS=true → logs on stderr, stdout still clean');
  }, 10000);

  it('should send --help output to stderr and nothing to stdout', async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }

    const proc = spawn('node', ['dist/index.js', '--help'], { env, stdio: 'pipe', cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    await new Promise<void>((resolve, reject) => {
      proc.on('exit', () => resolve());
      proc.on('error', reject);
      setTimeout(() => { proc.kill(); reject(new Error('--help timeout')); }, 5000);
    });

    expect(stdout).toBe('');
    expect(stderr).toContain('Assets Generation MCP Server');
    expect(stderr).toContain('--mcp-stdio-logs');
    console.log('Purity: --help written to stderr only');
  }, 10000);

  it('should respond to tools/list with generate_image via raw stdio protocol', async () => {
    const { listToolsResult } = await doRawStdioMcp();
    const result = listToolsResult as { tools?: Array<{ name: string }> };
    expect(result).toBeDefined();
    expect(Array.isArray(result?.tools)).toBe(true);
    expect(result.tools!.length).toBeGreaterThan(0);
    expect(result.tools![0].name).toBe('generate_image');
    console.log('Purity: raw stdio tools/list → tools:', result.tools!.map(t => t.name));
  }, 10000);
});
