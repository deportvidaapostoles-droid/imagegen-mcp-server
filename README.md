# Assets Generation MCP Server

AI 图片生成 MCP 服务器，支持 OpenAI DALL-E 和 Google Gemini 双 provider，返回标准 MCP `ImageContent`。

## 特性

- 根据模型名自动选择 provider（OpenAI / Gemini）
- 同时配置 OpenAI + Gemini 时，**按模型名选择 provider**；未指定模型时使用 `DEFAULT_MODEL`
- 图片以 MCP 标准 `ImageContent` 格式返回（`{ type: "image", data, mimeType }`），AI 客户端可直接使用
- 支持三种 transport：stdio（默认）、SSE、HTTP
- 支持自定义 API 代理地址（`OPENAI_BASE_URL` / `GEMINI_BASE_URL`）
- 支持 `.env` 自动加载，也支持通过 CLI 参数传配置（适合不支持 `env` 的 MCP 客户端）
- 未配置 API Key 的 provider 自动禁用，不影响另一个 provider 使用

## 快速开始

```bash
npm install
npm run build
cp .env.example .env  # 填入 API Key
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `GEMINI_API_KEY` | 至少一个 | - | Google Gemini API Key |
| `OPENAI_API_KEY` | 至少一个 | - | OpenAI API Key |
| `DEFAULT_MODEL` | 否 | `gemini-2.5-flash-image` | 默认模型，工具调用时可覆盖 |
| `GEMINI_BASE_URL` | 否 | - | Gemini API 代理地址 |
| `OPENAI_BASE_URL` | 否 | - | OpenAI API 代理地址 |
| `OPENAI_IMAGE_MODEL` | 否 | `gpt-image-2` | 集成测试时使用的 OpenAI 图片模型 |
| `MCP_TRANSPORT` | 否 | `stdio` | 传输模式：`stdio` / `sse` / `http` |
| `MCP_HOST` | 否 | `localhost` | SSE/HTTP 监听地址 |
| `MCP_PORT` | 否 | `3000` | SSE/HTTP 监听端口 |

> 至少配置 `GEMINI_API_KEY` 或 `OPENAI_API_KEY` 其中一个，未配置的 provider 会自动禁用。
>
> `.env` 中如果还是示例占位值（如 `your-gemini-api-key`），现在会被自动忽略，不会误判为已启用。
>
> 配置优先级：**CLI 参数 > 进程环境变量 > 当前工作目录 `.env` > 内置默认值**。

## 工具：`generate_image`

| 参数 | 必填 | 说明 |
|------|------|------|
| `prompt` | 是 | 图片描述 |
| `model` | 否 | 模型名，默认 `DEFAULT_MODEL` 环境变量值 |
| `size` | 否 | 图片尺寸（仅 OpenAI） |
| `quality` | 否 | `standard` / `hd`（仅 DALL-E 3） |
| `n` | 否 | 生成数量 |
| `aspect_ratio` | 否 | 宽高比（仅 Gemini）：`1:1` `3:4` `4:3` `9:16` `16:9` |
| `response_format` | 否 | `url` / `base64` / `auto`（默认） |

支持的模型：
- **OpenAI / OpenAI-compatible**: `gpt-image-2`, `gpt-image-1`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-3.0-generate-001`

## 使用方式

### Claude Desktop / Kiro（stdio 模式）

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

也可以不用 `env`，直接走 `args`：

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
Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### MCP SDK Client（编程接入）

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
// result.content → [{ type: "image", data: "<base64>", mimeType: "image/png" }]
```

### Provider 选择规则

1. 工具调用里**显式传了 `model`**：按 `model` 前缀选 provider
2. 工具调用里**没传 `model`**：使用 `DEFAULT_MODEL`
3. `gpt-image-*` / `dall-e-*` / `doubao-*` / `volcengine/doubao-*` → OpenAI-compatible；`gemini-*` / `imagen-*` → Gemini
4. 你的当前 `.env` 如果保持 `DEFAULT_MODEL=gpt-image-2`，那么**默认会走 OpenAI**

### SSE / HTTP 模式

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 node dist/index.js
```

端点：
- `GET /sse` — SSE 连接
- `POST /message?sessionId=xxx` — 发送消息
- `GET /` — 健康检查

### OpenAI 兼容代理联调

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-openai-compatible-endpoint
OPENAI_IMAGE_MODEL=gpt-image-2
npm run test:integration
```

如果你只想做一次快速真实联调，可以直接跑：

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-openai-compatible-endpoint
OPENAI_IMAGE_MODEL=gpt-image-2
npm run test:openai-proxy
```

这个脚本会依次验证：
1. 直连 `OPENAI_BASE_URL` 的 `images.generate`
2. 启动本仓库 MCP 服务后，通过 `generate_image` 走一遍 stdio 链路

如果只想检查代理实际暴露了哪些 OpenAI 模型：

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-openai-compatible-endpoint
npm run models:openai
```

如果 MCP 客户端不支持传 `env`，可以直接这样启动：

```bash
npx -y @ayaka209/assets-gen-mcp --openai-api-key sk-... --openai-base-url https://your-openai-compatible-endpoint --default-model gpt-image-2
```

查看所有 CLI 参数：

```bash
npx -y @ayaka209/assets-gen-mcp --help
```

## 开发

```bash
npm run build             # 编译
npm run watch             # 监听编译
npm test                  # 单元测试
npm run test:integration  # 集成测试（需要 API Key）
npm run test:openai-proxy # 一键测试 OpenAI 兼容代理
npm run models:openai     # 列出代理可见的 OpenAI 模型
npm run models            # 列出可用 Gemini 模型
```

## 技术栈

- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — MCP 服务端/客户端 SDK
- [`@google/genai`](https://www.npmjs.com/package/@google/genai) — Google Gemini SDK（支持 `baseUrl`）
- [`openai`](https://www.npmjs.com/package/openai) — OpenAI SDK

## License

MIT
