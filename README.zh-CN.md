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
- 支持三种 transport：stdio（默认）、Streamable HTTP（`/mcp`）、旧版 SSE
- **可部署到 Vercel**：作为远程 MCP 服务器运行（serverless 函数，无常驻进程）
- **可选的 OAuth 2.1 认证**：通过白名单限定谁可以使用服务器
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
| `IMAGEGEN_MAX_RETRIES` | 否 | `3` | 任务失败最大重试次数 |
| `IMAGEGEN_TASK_TIMEOUT` | 否 | `600` | 异步任务超时秒数 |
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

**失败重试：** 任务失败时会自动重试，最多 `IMAGEGEN_MAX_RETRIES` 次（默认 3 次），采用指数退避策略（2s、4s、8s...）。最终错误信息包含最后一次失败原因。

### 阻塞轮询模式

设置 `IMAGEGEN_BLOCKING_POLL=true` 可让 `get_task` 阻塞等待最多 120 秒，直到任务完成。适用于 MCP 客户端不方便自行实现轮询循环的场景。如果 120 秒内任务完成，直接返回结果；否则返回“仍在处理中”状态。

## 支持的模型

- **OpenAI / OpenAI-compatible**: `gpt-image-1`, `gpt-image-2`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-*`

## 远程 HTTP 传输

服务器在 `/mcp` 上实现了 MCP **Streamable HTTP** 传输（无状态模式：每个请求创建一个独立的
server 实例，不保存会话状态）。本地运行：

```bash
MCP_TRANSPORT=http MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
# MCP 端点   -> http://localhost:3000/mcp
# 健康检查   -> http://localhost:3000/health
```

旧版 HTTP+SSE 传输（`/sse` + `/message`）仍然保留，供旧客户端使用：

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
```

## 部署到 Vercel

仓库已经配置完毕，无需在 Vercel 面板中修改构建设置：

1. 在 Vercel 中导入该仓库（框架预设选择 *Other*）。
2. 配置环境变量（Project Settings → Environment Variables）：
   `IMAGEGEN_PROVIDER`、`IMAGEGEN_MODEL` 以及 `OPENAI_API_KEY`（或 `GEMINI_API_KEY`）。
   可选：`OPENAI_BASE_URL` / `GEMINI_BASE_URL`、`IMAGEGEN_TIMEOUT`。
   如需限制谁可以使用该部署，见[认证](#认证)。
3. `git push` 即可自动部署。

部署后的端点：

| 路由 | 函数 | 说明 |
|------|------|------|
| `POST /mcp` | `api/mcp.ts` | MCP 端点（Streamable HTTP） |
| `GET /health` | `api/health.ts` | 健康检查（`/api/health` 同样可用） |
| `GET /.well-known/oauth-protected-resource` | `api/oauth-protected-resource.ts` | 启用认证时的 OAuth 元数据（RFC 9728） |
| `GET /.well-known/oauth-authorization-server` | `api/oauth-authorization-server.ts` | 身份提供商发现文档的镜像 |
| `GET /` | 静态 | 说明页（`web/index.html`） |

客户端配置：

```json
{
  "mcpServers": {
    "imagegen": {
      "type": "http",
      "url": "https://<your-project>.vercel.app/mcp"
    }
  }
}
```

Serverless 注意事项：

- `vercel.json` 中 `/api/mcp` 的 `maxDuration` 为 60 秒，请将 `IMAGEGEN_TIMEOUT` 设置为更小的
  值（如 `55`），这样超时会返回标准的 MCP 错误而不是被平台直接中断。
- `submit_task` / `get_task` 的任务状态保存在单个实例的内存中，后续的 `get_task` 可能被路由到
  另一个实例。在 Vercel 上建议使用同步工具 `generate_image` / `edit_image`；异步工具主要面向
  stdio 与自托管 HTTP 部署。

## 认证

默认情况下 HTTP 端点是**开放的**——这对 stdio 或本地服务器没问题，但公开部署时不可接受：
任何知道 URL 的人都能消耗你的 API 额度。设置 `MCP_AUTH_MODE=oauth` 后，服务器会作为
OAuth 2.1 **资源服务器**运行：校验身份提供商签发的 bearer token，并对照白名单放行。

服务器本身不签发 token，也不保存会话状态。它会：

1. 对未认证请求返回 `401`，并在 `WWW-Authenticate` 中指向
   `/.well-known/oauth-protected-resource/mcp`（RFC 9728）；
2. 发布该元数据文档，客户端据此自动发现授权服务器；
3. 用提供商的 JWKS 校验 JWT：签名、issuer、过期时间，以及 `audience`
   （token 必须是**为本服务器**签发的，见 RFC 8707）；
4. 对不在 `MCP_ALLOWED_EMAILS` / `MCP_ALLOWED_EMAIL_DOMAINS` /
   `MCP_ALLOWED_SUBJECTS` 中的用户返回 `403`。

### 变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MCP_AUTH_MODE` | 是 | `oauth` 启用认证，`none`（默认）为开放端点 |
| `MCP_OAUTH_ISSUER` | oauth 模式 | 身份提供商的 issuer URL |
| `MCP_OAUTH_AUDIENCE` | oauth 模式 | token 的目标资源标识，通常为 `https://<project>.vercel.app/mcp` |
| `MCP_ALLOWED_EMAILS` | 建议 | 允许使用的邮箱列表，逗号分隔 |
| `MCP_ALLOWED_EMAIL_DOMAINS` | 否 | 放行某个域名下所有已验证邮箱 |
| `MCP_ALLOWED_SUBJECTS` | 否 | 按提供商用户 ID 放行（token 无 email claim 时） |
| `MCP_EMAIL_CLAIM` | 否 | 邮箱所在的 claim（默认 `email`，带命名空间的按后缀匹配） |
| `MCP_REQUIRED_SCOPES` | 否 | token 必须包含的 scope，如 `mcp:use` |
| `MCP_OAUTH_JWKS_URI` | 否 | 跳过发现流程，直接指定 JWKS |
| `MCP_PUBLIC_URL` | 否 | 代理改写 Host 时使用的规范公开 URL |

若设置了 `MCP_AUTH_MODE=oauth` 却缺少 issuer 或 audience，服务器会**拒绝所有请求**
（fail closed），而不是退化成无认证状态。

### 示例：Auth0

任何签发 JWT access token 的 OIDC 提供商均可。以 Auth0 为例：

1. **APIs → Create API**，Identifier 填 `https://<your-project>.vercel.app/mcp`
   （即 `MCP_OAUTH_AUDIENCE`）；需要 scope 的话添加 `mcp:use` 权限。
2. **Applications → Create → Regular Web Application**，回调地址加入
   `https://claude.ai/api/mcp/auth_callback`。若希望客户端自助注册，在
   *Tenant Settings → Advanced* 打开动态客户端注册；否则把 Client ID/Secret
   填进连接器的高级设置。
3. 想按邮箱放行，就在 *Login* 流程加一个 **Action**，把邮箱写进 access token：

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     api.accessToken.setCustomClaim('https://imagegen/email', event.user.email);
   };
   ```

   然后设置 `MCP_EMAIL_CLAIM=https://imagegen/email`（或保留默认值，改用
   `MCP_ALLOWED_SUBJECTS` 配置 Auth0 用户 ID）。
4. 在 Vercel 配置：

   ```
   MCP_AUTH_MODE=oauth
   MCP_OAUTH_ISSUER=https://<tenant>.us.auth0.com
   MCP_OAUTH_AUDIENCE=https://<your-project>.vercel.app/mcp
   MCP_EMAIL_CLAIM=https://imagegen/email
   MCP_ALLOWED_EMAILS=owner@example.com,manager@example.com
   ```

验证：

```bash
curl -i -X POST https://<your-project>.vercel.app/mcp   # -> 401 + WWW-Authenticate
curl -s https://<your-project>.vercel.app/.well-known/oauth-protected-resource/mcp
curl -s https://<your-project>.vercel.app/health        # -> "auth": "oauth"
```

## 项目结构

```
src/config.ts          CLI/环境变量配置解析
src/tools.ts           MCP 工具定义（JSON Schema）
src/image-service.ts   provider 调用（OpenAI / Gemini）-> MCP 内容块
src/task-store.ts      内存异步任务队列
src/mcp-server.ts      MCP server 工厂：工具注册与分发
src/http-transport.ts  Streamable HTTP 传输处理（无状态）+ 健康检查
src/index.ts           CLI 入口（stdio / http / sse）
src/auth.ts            OAuth bearer 校验 + 白名单 + 元数据
api/mcp.ts             Vercel serverless 函数 -> /mcp
api/health.ts          Vercel serverless 函数 -> /health
api/oauth-*.ts         Vercel serverless 函数 -> /.well-known/oauth-*
web/index.html         静态说明页（Vercel 输出目录）
```

## 开发

```bash
npm run build       # 编译到 dist/
npm run typecheck   # 类型检查 src/ 与 api/
npm run watch       # 监听编译
npm test            # 单元测试
npm start           # 以 stdio 运行已编译的服务器
npm run start:http  # 以 HTTP 运行：http://localhost:3000/mcp
```

## 技术栈

- `@modelcontextprotocol/sdk` — MCP SDK
- `@google/genai` — Google Gemini SDK
- `openai` — OpenAI SDK

## License

MIT
