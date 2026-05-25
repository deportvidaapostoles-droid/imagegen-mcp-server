# ImageGen MCP Server

[English](README.md) | [简体中文](README.zh-CN.md)

An MCP server for AI image generation and editing with dual-provider support for OpenAI-compatible models and Google Gemini. Returns standard MCP `ImageContent` blocks (base64).

## Features

- **Two tools**: `generate_image` (text-to-image) + `edit_image` (image editing)
- **Dual provider**: OpenAI-compatible models + Google Gemini
- **Provider explicitly set** via `IMAGEGEN_PROVIDER` env var (`openai` or `gemini`), not inferred from model name
- **Model set** via `IMAGEGEN_MODEL` env var — no model parameter in tool calls
- **Always returns base64 MCP ImageContent** — no temp files saved locally
- Three transports: stdio (default), SSE, HTTP
- Custom API proxy endpoints (`OPENAI_BASE_URL` / `GEMINI_BASE_URL`)
- Auto-loads `.env`, also supports CLI arguments for MCP clients that cannot pass `env`

## Installation

No installation required — run directly via `npx`:

```bash
npx -y github:ptbsare/imagegen-mcp-server
```

Or clone and build locally:

```bash
git clone https://github.com/ptbsare/imagegen-mcp-server.git
cd imagegen-mcp-server
npm install
npm run build
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IMAGEGEN_PROVIDER` | Yes | `openai` | Provider: `openai` or `gemini` |
| `IMAGEGEN_MODEL` | Yes | `gpt-image-1` | Model name |
| `IMAGEGEN_TIMEOUT` | No | `300` | Default tool timeout in seconds |
| `OPENAI_API_KEY` | When provider=openai | - | OpenAI API Key |
| `OPENAI_BASE_URL` | No | - | OpenAI API proxy URL |
| `GEMINI_API_KEY` | When provider=gemini | - | Gemini API Key |
| `GEMINI_BASE_URL` | No | - | Gemini API proxy URL |
| `MCP_TRANSPORT` | No | `stdio` | Transport: `stdio` / `sse` / `http` |
| `MCP_STDIO_LOGS` | No | `false` | Enable logs on stderr in stdio mode (debug) |
| `MCP_HOST` | No | `localhost` | SSE/HTTP bind host |
| `MCP_PORT` | No | `3000` | SSE/HTTP bind port |

> Priority: **CLI args > environment variables > `.env` file > built-in defaults**

## Usage

### npx (recommended)

```bash
# OpenAI
npx -y github:ptbsare/imagegen-mcp-server --provider openai --model gpt-image-1

# Gemini
npx -y github:ptbsare/imagegen-mcp-server --provider gemini --model gemini-2.5-flash-image
```

### Environment variables

```bash
IMAGEGEN_PROVIDER=gemini IMAGEGEN_MODEL=gemini-2.5-flash-image \
  GEMINI_API_KEY=your-key \
  npx -y github:ptbsare/imagegen-mcp-server
```

### Claude Desktop / Cursor (stdio)

```json
{
  "mcpServers": {
    "imagegen": {
      "command": "npx",
      "args": ["-y", "github:ptbsare/imagegen-mcp-server"],
      "env": {
        "IMAGEGEN_PROVIDER": "openai",
        "IMAGEGEN_MODEL": "gpt-image-1",
        "OPENAI_API_KEY": "sk-...",
        "OPENAI_BASE_URL": "https://your-proxy.com/v1"
      }
    }
  }
}
```

### With a proxy and custom model

```json
{
  "mcpServers": {
    "imagegen": {
      "command": "npx",
      "args": ["-y", "github:ptbsare/imagegen-mcp-server"],
      "env": {
        "IMAGEGEN_PROVIDER": "openai",
        "IMAGEGEN_MODEL": "gpt-image-2",
        "OPENAI_API_KEY": "sk-...",
        "OPENAI_BASE_URL": "https://your-openai-compatible-proxy.com/v1"
      }
    }
  }
}
```

### MCP SDK Client

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "github:ptbsare/imagegen-mcp-server"],
  env: {
    IMAGEGEN_PROVIDER: "gemini",
    IMAGEGEN_MODEL: "gemini-2.5-flash-image",
    GEMINI_API_KEY: "your-key",
  },
});
const client = new Client({ name: "my-app", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

// Generate an image
const result = await client.callTool({
  name: "generate_image",
  arguments: { prompt: "A cat in space" },
});

// Edit an image
const editResult = await client.callTool({
  name: "edit_image",
  arguments: {
    image: "/path/to/image.png",
    prompt: "Add a rainbow in the sky",
  },
});
```

## Tools

### `generate_image`

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `prompt` | Yes | - | Detailed text description of the image |
| `size` | No | provider-dependent | Image dimensions (OpenAI only) |
| `quality` | No | `standard` | Image quality |
| `n` | No | `1` | Number of images |
| `aspect_ratio` | No | `1:1` | Aspect ratio (Gemini only) |
| `timeout` | No | env `IMAGEGEN_TIMEOUT` | Timeout in seconds |

### `edit_image`

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `image` | Yes | - | Image to edit: file path or base64 string |
| `prompt` | Yes | - | Description of the desired edit |
| `mask` | No | - | Mask image for inpainting |
| `size` | No | provider-dependent | Output dimensions (OpenAI only) |
| `quality` | No | `standard` | Image quality (OpenAI only) |
| `n` | No | `1` | Number of images |
| `aspect_ratio` | No | `1:1` | Aspect ratio (Gemini only) |
| `timeout` | No | env `IMAGEGEN_TIMEOUT` | Timeout in seconds |

## Supported Models

- **OpenAI / OpenAI-compatible**: `gpt-image-1`, `gpt-image-2`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-*`

## SSE / HTTP Mode

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
```

Endpoints:
- `GET /sse` — SSE connection
- `POST /message?sessionId=xxx` — Send message
- `GET /` — Health check

## Development

```bash
npm run build       # Compile
npm run watch       # Watch mode
npm test            # Unit tests
```

## Tech Stack

- `@modelcontextprotocol/sdk` — MCP SDK
- `@google/genai` — Google Gemini SDK
- `openai` — OpenAI SDK

## License

MIT
