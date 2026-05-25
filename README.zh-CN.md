# ImageGen MCP Server

[English](README.md) | [简体中文](README.zh-CN.md)

AI 图片生成与编辑 MCP 服务器，支持 OpenAI 和 Google Gemini 双 Provider，返回标准 MCP `ImageContent`（base64）。

## 特性

- **双工具**：`generate_image`（文生图）+ `edit_image`（图片编辑）
- **双 Provider**：OpenAI 兼容模型 + Google Gemini
- **Provider 通过环境变量 `IMAGEGEN_PROVIDER` 显式指定**（`openai` 或 `gemini`），不再从模型名推断
- **模型通过环境变量 `IMAGEGEN_MODEL` 指定**，工具调用无需传 model 参数
- **统一返回 base64 MCP ImageContent**，不保存临时文件
- 支持三种 transport：stdio（默认）、SSE、HTTP
- 支持自定义 API 代理地址（`OPENAI_BASE_URL` / `GEMINI_BASE_URL`）
- 支持 `.env` 自动加载，也支持通过 CLI 参数传配置

## 安装

无需安装，通过 `npx` 直接运行：

```bash
npx -y github:ptbsare/imagegen-mcp-server
```

或克隆到本地构建：

```bash
git clone https://github.com/ptbsare/imagegen-mcp-server.git
cd imagegen-mcp-server
npm install
npm run build
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `IMAGEGEN_PROVIDER` | 是 | `openai` | Provider：`openai` 或 `gemini` |
| `IMAGEGEN_MODEL` | 是 | `gpt-image-1` | 模型名 |
| `IMAGEGEN_TIMEOUT` | 否 | `300` | 工具默认超时秒数 |
| `OPENAI_API_KEY` | provider=openai 时必填 | - | OpenAI API Key |
| `OPENAI_BASE_URL` | 否 | - | OpenAI API 代理地址 |
| `GEMINI_API_KEY` | provider=gemini 时必填 | - | Gemini API Key |
| `GEMINI_BASE_URL` | 否 | - | Gemini API 代理地址 |
| `MCP_TRANSPORT` | 否 | `stdio` | 传输模式：`stdio` / `sse` / `http` |
| `MCP_STDIO_LOGS` | 否 | `false` | stdio 模式下启用日志（调试用） |
| `MCP_HOST` | 否 | `localhost` | SSE/HTTP 监听地址 |
| `MCP_PORT` | 否 | `3000` | SSE/HTTP 监听端口 |

> 配置优先级：**CLI 参数 > 进程环境变量 > 当前工作目录 `.env` > 内置默认值**

## 使用方式

### npx 直接运行（推荐）

```bash
# OpenAI
npx -y github:ptbsare/imagegen-mcp-server --provider openai --model gpt-image-1

# Gemini
npx -y github:ptbsare/imagegen-mcp-server --provider gemini --model gemini-2.5-flash-image
```

### 环境变量方式

```bash
IMAGEGEN_PROVIDER=gemini IMAGEGEN_MODEL=gemini-2.5-flash-image \
  GEMINI_API_KEY=your-key \
  npx -y github:ptbsare/imagegen-mcp-server
```

### Claude Desktop / Cursor（stdio 模式）

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

### 配合代理和自定义模型

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

### MCP SDK Client（编程接入）

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

// 生成图片
const result = await client.callTool({
  name: "generate_image",
  arguments: { prompt: "A cat in space" },
});

// 编辑图片
const editResult = await client.callTool({
  name: "edit_image",
  arguments: {
    image: "/path/to/image.png",
    prompt: "Add a rainbow in the sky",
  },
});
```

## 工具列表

### `generate_image`

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | 是 | - | 详细的图片描述 |
| `size` | 否 | provider 相关 | 图片尺寸（仅 OpenAI） |
| `quality` | 否 | `standard` | 图片质量 |
| `n` | 否 | `1` | 生成数量 |
| `aspect_ratio` | 否 | `1:1` | 宽高比（仅 Gemini） |
| `timeout` | 否 | 环境变量 `IMAGEGEN_TIMEOUT` | 超时秒数 |

### `edit_image`

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `image` | 是 | - | 图片路径或 base64 字符串 |
| `prompt` | 是 | - | 编辑描述 |
| `mask` | 否 | - | 遮罩图片（仅 OpenAI） |
| `size` | 否 | provider 相关 | 输出尺寸（仅 OpenAI） |
| `quality` | 否 | `standard` | 图片质量（仅 OpenAI） |
| `n` | 否 | `1` | 生成数量 |
| `aspect_ratio` | 否 | `1:1` | 宽高比（仅 Gemini） |
| `timeout` | 否 | 环境变量 `IMAGEGEN_TIMEOUT` | 超时秒数 |

## 支持的模型

- **OpenAI / OpenAI-compatible**: `gpt-image-1`, `gpt-image-2`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-*`

## SSE / HTTP 模式

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
```

端点：
- `GET /sse` — SSE 连接
- `POST /message?sessionId=xxx` — 发送消息
- `GET /` — 健康检查

## 开发

```bash
npm run build       # 编译
npm run watch       # 监听编译
npm test            # 单元测试
```

## 技术栈

- `@modelcontextprotocol/sdk` — MCP SDK
- `@google/genai` — Google Gemini SDK
- `openai` — OpenAI SDK

## License

MIT
