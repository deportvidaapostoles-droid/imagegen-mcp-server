#!/usr/bin/env node
import { existsSync } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadDotEnv, getServerRuntimeConfig } from './config.js';

loadDotEnv();
const config = getServerRuntimeConfig();
config.warnings.forEach((warning) => console.warn(`Config warning: ${warning}`));

const OPENAI_API_KEY = config.openaiApiKey;
const OPENAI_BASE_URL = config.openaiBaseUrl;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || config.model;
const OPENAI_IMAGE_PROMPT = process.env.OPENAI_IMAGE_PROMPT || 'A simple black circle on a white background';

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function testDirectOpenAI(): Promise<void> {
  const client = new OpenAI({
    apiKey: requireEnv('OPENAI_API_KEY', OPENAI_API_KEY),
    baseURL: requireEnv('OPENAI_BASE_URL', OPENAI_BASE_URL),
  });

  const response = await client.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt: OPENAI_IMAGE_PROMPT,
    size: '1024x1024',
    response_format: 'b64_json',
  });

  const image = response.data?.[0];
  if (!image) throw new Error('Direct OpenAI test returned no image results');
  if (!image.b64_json) throw new Error('Expected b64_json response');
  console.log(`Direct ${OPENAI_IMAGE_MODEL}: received b64_json`);
}

async function testMcpOverStdio(): Promise<void> {
  const serverPath = path.resolve(process.cwd(), 'dist', 'index.js');
  if (!existsSync(serverPath)) {
    throw new Error(`Built MCP server not found at ${serverPath}. Run 'npm run build' first.`);
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.OPENAI_API_KEY = requireEnv('OPENAI_API_KEY', OPENAI_API_KEY);
  if (OPENAI_BASE_URL) env.OPENAI_BASE_URL = OPENAI_BASE_URL;
  env.IMAGEGEN_PROVIDER = 'openai';
  env.IMAGEGEN_MODEL = OPENAI_IMAGE_MODEL;

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env,
  });

  const client = new Client(
    { name: 'openai-proxy-smoke-test', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    if (!tools.some((tool) => tool.name === 'generate_image')) {
      throw new Error('MCP server did not expose generate_image');
    }

    const result = await client.callTool({
      name: 'generate_image',
      arguments: { prompt: OPENAI_IMAGE_PROMPT },
    });

    const imageBlock = (result.content as Array<{ type: string; data?: string; mimeType?: string }>).find(
      (block) => block.type === 'image',
    );

    if (!imageBlock?.data || !imageBlock.mimeType?.startsWith('image/')) {
      throw new Error(`MCP generate_image did not return image content: ${JSON.stringify(result.content)}`);
    }

    console.log(`MCP stdio ${OPENAI_IMAGE_MODEL}: received ${imageBlock.mimeType}`);
  } finally {
    await client.close();
  }
}

async function main() {
  requireEnv('OPENAI_API_KEY', OPENAI_API_KEY);
  requireEnv('OPENAI_BASE_URL', OPENAI_BASE_URL);

  console.log(`Testing OpenAI-compatible endpoint with model ${OPENAI_IMAGE_MODEL}`);
  console.log(`Base URL: ${OPENAI_BASE_URL}`);

  await testDirectOpenAI();
  await testMcpOverStdio();

  console.log('All OpenAI-compatible proxy checks passed.');
}

main().catch((error) => {
  console.error('OpenAI-compatible proxy test failed:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
