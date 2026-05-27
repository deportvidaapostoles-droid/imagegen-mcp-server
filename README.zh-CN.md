# ImageGen MCP Server

[English](README.md) | [简体中文](README.zh-CN.md)

AI 图片生成与编辑 MCP 服务器，支持 OpenAI 和 Google Gemini 双 Provider，返回标准 MCP `ImageContent`（base64）。

## 特性

- **异步任务工具**：`submit_task` + `get_task`，非阻塞式生图/编辑
- **同步工具**：`generate_image` + `edit_image`，直接调用（可能超时）
- **双 Provider**：OpenAI 兼容模型 + Google Gemini
- **Provider 通过环境变量 `IMAGEGEN_PROVIDER` 显式指定**（`openai` 或 `gemini`）
- **模型通过环境变量 `IMAGEGEN_MODEL` 指定**，工具调用无需传 model 参数
- **统一返回 base64 MCP ImageContent**，不保存临时文件
- **多图编辑**：OpenAI 和 Gemini 均支持多图输入
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
| `IMAGEGEN_ASYNC_ONLY` | 否 | `false` | 只暴露异步任务工具 |
| `IMAGEGEN_BLOCKING_POLL` | 否 | `false` | get_task 阻塞等待避免频繁轮询 |
| `IMAGEGEN_BLOCKING_POLL_TIMEOUT` | 否 | `120` | 阻塞轮询超时秒数 |
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

# 仅异步模式（只暴露 submit_task 和 get_task）
IMAGEGEN_ASYNC_ONLY=true npx -y github:ptbsare/imagegen-mcp-server
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

### 仅异步模式

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

## 工具列表

### 异步工具（始终可用）

#### `submit_task`

提交生图或编辑任务，立即返回 `task_id`。

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `kind` | 是 | - | 任务类型：`generate` 或 `edit` |
| `prompt` | 是 | - | 生图提示词或编辑描述 |
| `images` | edit 时必填 | - | 图片数组（文件路径或 base64） |

**生图示例：**
```json
{
  "kind": "generate",
  "prompt": "A photorealistic red apple on a white marble table"
}
```

**编辑示例：**
```json
{
  "kind": "edit",
  "images": ["/path/to/image.png"],
  "prompt": "Add a rainbow in the sky"
}
```

**响应：**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Task submitted. Use get_task with task_id to check status."
}
```

#### `get_task`

查询任务状态和结果。

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `task_id` | 是 | - | submit_task 返回的 task_id |

**处理中响应：**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "message": "Task is still processing. Check again later."
}
```

**完成响应：**
返回 `status: "completed"` 加上 MCP `ImageContent` 图片块（每张图一个）。

### 同步工具（`IMAGEGEN_ASYNC_ONLY=true` 时禁用）

#### `generate_image`

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | 是 | - | 详细的图片描述 |
| `size` | 否 | provider 相关 | 图片尺寸（仅 OpenAI） |
| `quality` | 否 | `standard` | 图片质量（仅 OpenAI） |
| `n` | 否 | `1` | 生成数量（仅 OpenAI） |
| `aspect_ratio` | 否 | `1:1` | 宽高比（仅 Gemini） |
| `timeout` | 否 | 环境变量 `IMAGEGEN_TIMEOUT` | 超时秒数 |

#### `edit_image`

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `images` | 是 | - | 待编辑图片（文件路径或 base64） |
| `prompt` | 是 | - | 编辑描述 |
| `mask` | 否 | - | 遮罩图片（仅 OpenAI） |
| `size` | 否 | provider 相关 | 输出尺寸（仅 OpenAI） |
| `quality` | 否 | `standard` | 图片质量（仅 OpenAI） |
| `n` | 否 | `1` | 生成数量（仅 OpenAI） |
| `aspect_ratio` | 否 | `1:1` | 宽高比（仅 Gemini） |
| `timeout` | 否 | 环境变量 `IMAGEGEN_TIMEOUT` | 超时秒数 |

## 异步工作流

推荐的慢速生图流程：

```
1. submit_task → 立即返回 task_id
2. get_task(task_id) → 返回 "processing"
3. get_task(task_id) → 返回 "processing"
4. get_task(task_id) → 返回 "completed" + ImageContent[]
```

**为什么用异步？** 图片生成可能需要 30-120+ 秒。异步模式通过解耦提交和结果获取，避免 MCP 客户端超时。

### 阻塞轮询模式

设置 `IMAGEGEN_BLOCKING_POLL=true` 可让 `get_task` 阻塞等待最多 120 秒，直到任务完成。适用于 MCP 客户端不方便自行实现轮询循环的场景。如果 120 秒内任务完成，直接返回结果；否则返回“仍在处理中”状态。

## 支持的模型

- **OpenAI / OpenAI-compatible**: `gpt-image-1`, `gpt-image-2`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-*`

## SSE / HTTP 模式

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
```

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
