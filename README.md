# ImageGen MCP Server

[English](README.md) | [简体中文](README.zh-CN.md)

An MCP server for AI image generation and editing with dual-provider support for OpenAI-compatible models and Google Gemini. Returns standard MCP `ImageContent` blocks (base64).

## Features

- **Async task tools**: `submit_task` + `get_task` for non-blocking image generation/editing
- **Sync tools**: `generate_image` + `edit_image` for direct calls (may timeout on slow providers)
- **Dual provider**: OpenAI-compatible models + Google Gemini
- **Provider explicitly set** via `IMAGEGEN_PROVIDER` env var (`openai` or `gemini`)
- **Model set** via `IMAGEGEN_MODEL` env var — no model parameter in tool calls
- **Always returns base64 MCP ImageContent** — no temp files saved locally
- **Multi-image editing** supported for both OpenAI and Gemini
- Three transports: stdio (default), SSE, HTTP
- Custom API proxy endpoints (`OPENAI_BASE_URL` / `GEMINI_BASE_URL`)
- Auto-loads `.env`, also supports CLI arguments

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
| `IMAGEGEN_ASYNC_ONLY` | No | `false` | Only expose async task tools |
| `IMAGEGEN_BLOCKING_POLL` | No | `false` | Block get_task for 120s to prevent rapid polling |
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

# Async-only mode (only submit_task and get_task tools)
IMAGEGEN_ASYNC_ONLY=true npx -y github:ptbsare/imagegen-mcp-server
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

### Async-only mode

```json
{
  "mcpServers": {
    "imagegen": {
      "command": "npx",
      "args": ["-y", "github:ptbsare/imagegen-mcp-server"],
      "env": {
        "IMAGEGEN_PROVIDER": "openai",
        "IMAGEGEN_MODEL": "gpt-image-1",
        "IMAGEGEN_ASYNC_ONLY": "true",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Tools

### Async Tools (always available)

#### `submit_task`

Submit an image generation or editing task. Returns immediately with a `task_id`.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `kind` | Yes | - | Task type: `generate` or `edit` |
| `prompt` | Yes | - | Text prompt for generation or edit description |
| `images` | For `edit` | - | Array of images (file path or base64) |

**Example — Generate:**
```json
{
  "kind": "generate",
  "prompt": "A photorealistic red apple on a white marble table"
}
```

**Example — Edit:**
```json
{
  "kind": "edit",
  "images": ["/path/to/image.png"],
  "prompt": "Add a rainbow in the sky"
}
```

**Response:**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Task submitted. Use get_task with task_id to check status."
}
```

#### `get_task`

Check task status and retrieve results.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `task_id` | Yes | - | The task_id returned by submit_task |

**Response (processing):**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "message": "Task is still processing. Check again later."
}
```

**Response (completed):**
Returns `status: "completed"` plus MCP `ImageContent` blocks (one per generated image).

### Sync Tools (disabled when `IMAGEGEN_ASYNC_ONLY=true`)

#### `generate_image`

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `prompt` | Yes | - | Detailed text description |
| `size` | No | provider-dependent | Image dimensions (OpenAI only) |
| `quality` | No | `standard` | Image quality (OpenAI only) |
| `n` | No | `1` | Number of images (OpenAI only) |
| `aspect_ratio` | No | `1:1` | Aspect ratio (Gemini only) |
| `timeout` | No | env `IMAGEGEN_TIMEOUT` | Timeout in seconds |

#### `edit_image`

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `images` | Yes | - | Images to edit (file path or base64) |
| `prompt` | Yes | - | Description of the desired edit |
| `mask` | No | - | Mask image for inpainting (OpenAI only) |
| `size` | No | provider-dependent | Output dimensions (OpenAI only) |
| `quality` | No | `standard` | Image quality (OpenAI only) |
| `n` | No | `1` | Number of images (OpenAI only) |
| `aspect_ratio` | No | `1:1` | Aspect ratio (Gemini only) |
| `timeout` | No | env `IMAGEGEN_TIMEOUT` | Timeout in seconds |

## Async Workflow

The recommended workflow for slow image generation:

```
1. submit_task → returns task_id immediately
2. get_task(task_id) → returns "processing"
3. get_task(task_id) → returns "processing"
4. get_task(task_id) → returns "completed" + ImageContent[]
```

**Why async?** Image generation can take 30-120+ seconds. The async pattern prevents MCP client timeouts by decoupling submission from result retrieval.

### Blocking Poll Mode

Set `IMAGEGEN_BLOCKING_POLL=true` to make `get_task` block for up to 120 seconds waiting for task completion. This is useful when the MCP client cannot easily implement polling loops. If the task completes within 120s, the result is returned directly. Otherwise, it returns a "still processing" status.

## Supported Models

- **OpenAI / OpenAI-compatible**: `gpt-image-1`, `gpt-image-2`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-*`

## SSE / HTTP Mode

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
```

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
