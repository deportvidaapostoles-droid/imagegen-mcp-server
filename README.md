# Assets Generation MCP Server

[English](README.md) | [简体中文](README.zh-CN.md)

An MCP server for AI image generation with dual-provider support for OpenAI-compatible models and Google Gemini. It returns standard MCP `ImageContent` blocks.

## Features

- Automatically selects the provider from the model name
- When both OpenAI and Gemini are configured, provider selection is still based on the requested model; if no model is provided, `DEFAULT_MODEL` is used
- Returns images as MCP-standard `ImageContent` (`{ type: "image", data, mimeType }`)
- Supports three transports: stdio (default), SSE, and HTTP
- Supports custom API proxy endpoints (`OPENAI_BASE_URL` / `GEMINI_BASE_URL`)
- Automatically loads `.env`, and also supports CLI arguments for MCP clients that cannot pass `env`
- Providers without valid API keys are disabled automatically without affecting the other provider

## Quick Start

```bash
npm install
npm run build
cp .env.example .env
```

## Environment Variables

| Variable | Required | Default | Description |
|------|------|--------|------|
| `GEMINI_API_KEY` | One provider required | - | Google Gemini API key |
| `OPENAI_API_KEY` | One provider required | - | OpenAI-compatible API key |
| `DEFAULT_MODEL` | No | `gemini-2.5-flash-image` | Default model when the tool call does not provide `model` |
| `GEMINI_BASE_URL` | No | - | Gemini API proxy endpoint |
| `OPENAI_BASE_URL` | No | - | OpenAI-compatible API proxy endpoint |
| `OPENAI_IMAGE_MODEL` | No | `gpt-image-2` | OpenAI-compatible image model used in integration tests |
| `MCP_TRANSPORT` | No | `stdio` | Transport mode: `stdio` / `sse` / `http` |
| `MCP_STDIO_LOGS` | No | `false` | Enable startup/runtime logs in stdio mode (set `true` to re-enable for debugging) |
| `MCP_HOST` | No | `localhost` | Host for SSE/HTTP mode |
| `MCP_PORT` | No | `3000` | Port for SSE/HTTP mode |

> Configure at least one of `GEMINI_API_KEY` or `OPENAI_API_KEY`.
>
> Placeholder values in `.env` such as `your-gemini-api-key` are ignored automatically.
>
> Configuration precedence is: **CLI arguments > process environment variables > `.env` in the current working directory > built-in defaults**.

## Tool: `generate_image`

| Parameter | Required | Default | Description |
|------|------|--------|------|
| `prompt` | Yes | - | Detailed image description |
| `model` | No | `DEFAULT_MODEL` | Model name — see supported models below |
| `size` | No | `auto` / `1024x1024` | Image dimensions for OpenAI-compatible models |
| `quality` | No | `standard` | `high`/`medium`/`low`/`standard` (gpt-image-*) or `hd`/`standard` (dall-e-3) |
| `n` | No | `1` | Number of images (gpt-image-*: 1–10; dall-e-3: 1; Gemini: 1) |
| `aspect_ratio` | No | `1:1` | Gemini-only: `1:1` `3:4` `4:3` `9:16` `16:9` |
| `response_format` | No | `auto` | `url` / `base64` / `auto` |
| `timeout` | No | `120` | Max wait time in **seconds**. Increase for slow proxies or high-quality models |

Supported model families:

- **OpenAI / OpenAI-compatible**: `gpt-image-2`, `gpt-image-1`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-3.0-generate-001`

## Usage

### Claude Desktop / Kiro (stdio mode)

```json
{
  "mcpServers": {
    "assets-gen": {
      "command": "node",
      "args": ["/path/to/assets-gen-mcp/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-key",
        "GEMINI_BASE_URL": "https://your-proxy.com"
      }
    }
  }
}
```

If your MCP client cannot pass `env`, use CLI arguments instead:

```json
{
  "mcpServers": {
    "assets-gen": {
      "command": "npx",
      "args": [
        "-y",
        "@ayaka209/assets-gen-mcp",
        "--openai-api-key",
        "your-key",
        "--openai-base-url",
        "https://your-proxy.com/gptapi",
        "--default-model",
        "gpt-image-2"
      ]
    }
  }
}
```

macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`  
Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`

### MCP SDK Client

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { GEMINI_API_KEY: "your-key" },
});

const client = new Client({ name: "my-app", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

const result = await client.callTool({
  name: "generate_image",
  arguments: { prompt: "A cat in space" },
});

// result.content -> [{ type: "image", data: "<base64>", mimeType: "image/png" }]
```

### Provider Selection Rules

1. If `model` is provided, the provider is chosen from the model prefix
2. If `model` is omitted, `DEFAULT_MODEL` is used
3. `gpt-image-*` / `dall-e-*` / `doubao-*` / `volcengine/doubao-*` go to the OpenAI-compatible path
4. `gemini-*` / `imagen-*` go to the Gemini path

### SSE / HTTP Mode

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 node dist/index.js
```

Endpoints:

- `GET /sse` - SSE connection
- `POST /message?sessionId=xxx` - Send messages
- `GET /` - Health check

### OpenAI-Compatible Proxy Testing

Run the full integration tests:

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-openai-compatible-endpoint
OPENAI_IMAGE_MODEL=gpt-image-2
npm run test:integration
```

For a single end-to-end smoke test:

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-openai-compatible-endpoint
OPENAI_IMAGE_MODEL=gpt-image-2
npm run test:openai-proxy
```

This script verifies:

1. A direct `images.generate` call against `OPENAI_BASE_URL`
2. A stdio MCP round-trip through this repository's `generate_image` tool

To inspect which OpenAI-compatible models your endpoint exposes:

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-openai-compatible-endpoint
npm run models:openai
```

If your MCP client cannot pass `env`, you can launch it directly with CLI arguments:

```bash
npx -y @ayaka209/assets-gen-mcp --openai-api-key sk-... --openai-base-url https://your-openai-compatible-endpoint --default-model gpt-image-2
```

Show all supported CLI options:

```bash
npx -y @ayaka209/assets-gen-mcp --help
```

## Development

```bash
npm run build             # Build
npm run watch             # Watch TypeScript
npm test                  # Unit tests
npm run test:integration  # Integration tests (requires API keys)
npm run test:openai-proxy # One-command OpenAI-compatible smoke test
npm run models:openai     # List OpenAI-compatible models visible to the endpoint
npm run models            # List available Gemini models
```

## Tech Stack

- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) - MCP server/client SDK
- [`@google/genai`](https://www.npmjs.com/package/@google/genai) - Google Gemini SDK
- [`openai`](https://www.npmjs.com/package/openai) - OpenAI SDK

## License

MIT
