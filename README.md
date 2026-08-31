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
- Three transports: stdio (default), Streamable HTTP (`/mcp`), legacy SSE
- **Deployable to Vercel** as a remote MCP server (serverless functions, no persistent process)
- **Optional authentication**: a shared secret, or OAuth 2.1 with an allow-list of who may use the server
- **Image uploads**: hand the tools a URL instead of megabytes of base64
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
| `IMAGEGEN_BLOCKING_POLL` | No | `false` | Block get_task to prevent rapid polling |
| `IMAGEGEN_BLOCKING_POLL_TIMEOUT` | No | `120` | Blocking poll timeout in seconds |
| `IMAGEGEN_MAX_RETRIES` | No | `3` | Max retries on task failure |
| `IMAGEGEN_TASK_TIMEOUT` | No | `600` | Async task timeout in seconds |
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

**Retry on failure:** Failed tasks are automatically retried up to `IMAGEGEN_MAX_RETRIES` times (default: 3) with exponential backoff (2s, 4s, 8s...). The final error message includes the last failure reason.

**Task timeout:** Each task attempt has a maximum duration of `IMAGEGEN_TASK_TIMEOUT` seconds (default: 600). If the upstream API doesn't respond within this time, the attempt is considered failed and will be retried.

### Blocking Poll Mode

Set `IMAGEGEN_BLOCKING_POLL=true` to make `get_task` block for up to 120 seconds waiting for task completion. This is useful when the MCP client cannot easily implement polling loops. If the task completes within 120s, the result is returned directly. Otherwise, it returns a "still processing" status.

## Supported Models

- **OpenAI / OpenAI-compatible**: `gpt-image-1`, `gpt-image-2`, `dall-e-3`, `dall-e-2`, `doubao-*`, `volcengine/doubao-*`
- **Gemini**: `gemini-2.5-flash-image`, `gemini-2.0-flash-exp`, `imagen-*`

## Remote HTTP transport

The server implements the MCP **Streamable HTTP** transport on `/mcp` (stateless mode: one
server instance per request, no session state). Run it locally with:

```bash
MCP_TRANSPORT=http MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
# MCP endpoint    -> http://localhost:3000/mcp
# Health endpoint -> http://localhost:3000/health
```

The legacy HTTP+SSE transport (`/sse` + `/message`) is still available for older clients:

```bash
MCP_TRANSPORT=sse MCP_PORT=3000 npx -y github:ptbsare/imagegen-mcp-server
```

## Deploy to Vercel

The repository is ready to deploy as-is — no dashboard build settings need to be changed:

1. Import the repository in Vercel (framework preset: *Other*).
2. Add the environment variables (Project Settings → Environment Variables):
   `IMAGEGEN_PROVIDER`, `IMAGEGEN_MODEL` and `OPENAI_API_KEY` (or `GEMINI_API_KEY`).
   Optional: `OPENAI_BASE_URL` / `GEMINI_BASE_URL`, `IMAGEGEN_TIMEOUT`.
   To restrict who can use the deployment, see [Authentication](#authentication).
3. `git push` — every push deploys automatically.

Resulting endpoints:

| Route | Function | Description |
|-------|----------|-------------|
| `POST /mcp` | `api/mcp.ts` | MCP endpoint (Streamable HTTP) |
| `GET /health` | `api/health.ts` | Health check (`/api/health` also works) |
| `POST /api/upload` | `api/upload.ts` | Upload an image, get a URL for `edit_image` (needs a Blob store) |
| `GET /.well-known/oauth-protected-resource` | `api/oauth-protected-resource.ts` | OAuth metadata (RFC 9728), when authentication is enabled |
| `GET /.well-known/oauth-authorization-server` | `api/oauth-authorization-server.ts` | Mirror of the identity provider's discovery document |
| `GET /` | static | Landing page (`web/index.html`) |

Connect any modern MCP client:

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

Serverless notes:

- `vercel.json` sets `maxDuration: 60` for `/api/mcp`. Keep `IMAGEGEN_TIMEOUT` below that
  (e.g. `55`) so the tool returns a proper MCP error instead of the platform killing the
  request. Longer generations need a plan with a higher function duration limit.
- `submit_task` / `get_task` keep their task state in the memory of a single instance, so a
  follow-up `get_task` may land on a different instance. Prefer the synchronous
  `generate_image` / `edit_image` tools on Vercel; the async tools remain intended for the
  stdio and self-hosted HTTP deployments.

## Authentication

By default the HTTP endpoint is **open**, which is fine for stdio or a local
server but not for a public deployment: anyone who learns the URL can spend your
provider credits. Two modes close it:

| Mode | Setup | Good for |
|------|-------|----------|
| `MCP_AUTH_MODE=token` | One env var, no third party | A handful of trusted people; works with clients that cannot send custom headers |
| `MCP_AUTH_MODE=oauth` | An identity provider (Auth0, WorkOS, Okta, Entra ID…) | Real per-person logins, revocable, auditable |

### Shared-secret mode

Set `MCP_AUTH_TOKENS` to one or more secrets (comma-separated — issue one per
person so you can revoke them individually) and `MCP_AUTH_MODE=token`. Generate
them with `openssl rand -hex 32`. A caller may present the secret as:

- `Authorization: Bearer <secret>`,
- `?token=<secret>` in the query string, or
- the URL path: `https://<deployment>/mcp/<secret>` — the only option for
  clients whose connector UI takes a URL and nothing else.

The secret is compared in constant time, and no `WWW-Authenticate` header is
sent, so clients do not go looking for a login server that does not exist. Keep
in mind that a secret in a URL travels through browser history, proxy logs and
platform access logs: it is far better than an open endpoint, weaker than OAuth.

### OAuth mode

`MCP_AUTH_MODE=oauth` turns the server into an OAuth 2.1 *resource server*: it
verifies bearer tokens issued by your identity provider and checks the caller
against an allow-list.

The server never issues tokens and keeps no session state. It:

1. answers unauthenticated requests with `401` and a `WWW-Authenticate` header
   pointing at `/.well-known/oauth-protected-resource/mcp` (RFC 9728),
2. publishes that metadata document so the client discovers the authorization
   server on its own,
3. verifies the JWT access token against the provider's JWKS — signature,
   issuer, expiry, and `audience` (the token must have been minted *for this
   server*, per RFC 8707),
4. rejects anyone outside `MCP_ALLOWED_EMAILS` / `MCP_ALLOWED_EMAIL_DOMAINS` /
   `MCP_ALLOWED_SUBJECTS` with `403`.

### Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_AUTH_MODE` | yes | `token`, `oauth`, or `none` (default) to leave the endpoint open |
| `MCP_AUTH_TOKENS` | with `token` | Comma-separated shared secrets |
| `MCP_OAUTH_ISSUER` | with `oauth` | Issuer URL of the identity provider |
| `MCP_OAUTH_AUDIENCE` | with `oauth` | Resource identifier the token must target — normally `https://<project>.vercel.app/mcp` |
| `MCP_ALLOWED_EMAILS` | recommended | Comma-separated list of the people allowed in |
| `MCP_ALLOWED_EMAIL_DOMAINS` | no | Allow every verified address of a domain |
| `MCP_ALLOWED_SUBJECTS` | no | Allow by provider user id, for tokens without an email claim |
| `MCP_EMAIL_CLAIM` | no | Claim carrying the email (default `email`; namespaced claims are matched by suffix) |
| `MCP_REQUIRED_SCOPES` | no | Scopes the token must carry, e.g. `mcp:use` |
| `MCP_OAUTH_JWKS_URI` | no | Skip discovery and use this JWKS directly |
| `MCP_PUBLIC_URL` | no | Canonical public URL, when a proxy rewrites `Host` |

If `MCP_AUTH_MODE=oauth` is set without an issuer or audience the server **fails
closed**: every request is rejected rather than silently served without auth.

### Example: Auth0

Any OIDC provider issuing JWT access tokens works. With Auth0:

1. **APIs → Create API**. Identifier: `https://<your-project>.vercel.app/mcp`
   (this becomes `MCP_OAUTH_AUDIENCE`). Add a permission such as `mcp:use` if
   you want to require a scope.
2. **Applications → Create → Regular Web Application**, and allow
   `https://claude.ai/api/mcp/auth_callback` as a callback URL (add the callback
   of any other client you use). Enable Dynamic Client Registration under
   *Tenant Settings → Advanced* if you want clients to register themselves; with
   it off, paste the application's Client ID/Secret into the connector's
   advanced settings.
3. To match users by email, add an **Action** on the *Login* flow so the access
   token carries the address:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     api.accessToken.setCustomClaim('https://imagegen/email', event.user.email);
   };
   ```

   Then set `MCP_EMAIL_CLAIM=https://imagegen/email` (or leave the default and
   use `MCP_ALLOWED_SUBJECTS` with the Auth0 user ids).
4. In Vercel set:

   ```
   MCP_AUTH_MODE=oauth
   MCP_OAUTH_ISSUER=https://<tenant>.us.auth0.com
   MCP_OAUTH_AUDIENCE=https://<your-project>.vercel.app/mcp
   MCP_EMAIL_CLAIM=https://imagegen/email
   MCP_ALLOWED_EMAILS=owner@example.com,manager@example.com
   ```

Verify with:

```bash
curl -i -X POST https://<your-project>.vercel.app/mcp   # -> 401 + WWW-Authenticate
curl -s https://<your-project>.vercel.app/.well-known/oauth-protected-resource/mcp
curl -s https://<your-project>.vercel.app/health        # -> "auth": "oauth"
```

## Sending images to a remote server

`edit_image` and `submit_task` accept an image in three forms:

| Form | Works where | Notes |
|------|-------------|-------|
| `https://…` URL | everywhere | The reliable option for a remote deployment |
| base64 / data URL | everywhere | Fine for small images; a large one gets truncated in transit |
| `/absolute/path.png` | stdio and self-hosted HTTP only | The Vercel function has no access to your filesystem |

A file path fails on Vercel with `ENOENT: no such file or directory` — not a bug:
the file is on the caller's machine and the function runs elsewhere. The two
never share a disk. Inlining the image as base64 is possible in principle but
brittle in practice: an agent copying a megabyte-long string into a tool call
truncates it, and the provider answers `Base64 decoding failed`.

Hence uploads. Connect a Vercel Blob store to the project (*Storage → Create →
Blob*); Vercel then sets `BLOB_READ_WRITE_TOKEN` for you and `/api/upload`
starts working:

```bash
curl -X POST --data-binary @photo.png \
     -H 'content-type: image/png' \
     -H 'authorization: Bearer <your MCP_AUTH_TOKENS value>' \
     https://<your-project>.vercel.app/api/upload
# {"url":"https://….public.blob.vercel-storage.com/imagegen/….png", …}
```

Pass that `url` in `images`. Once a Blob store is connected the server also
advertises an **`upload_image` tool**, so the client can do this itself: hand it
the base64 once, get a URL back, and reuse that URL across every edit of the
same photo instead of re-sending the image on each call. There is also a
drag-and-drop page at `/upload.html` for when neither is convenient. Uploads accept PNG, JPEG,
WebP and GIF up to 25 MB and require the same authentication as `/mcp`.

The URL you get back depends on how the Blob store was created:

- **Public store** — a permanent, unguessable URL. Anyone holding the link can
  view the image.
- **Private store** — a signed URL that expires (6 h by default, set
  `BLOB_URL_TTL_SECONDS` to change it). Nothing is left publicly readable once
  it lapses, which is the better default for customer or product photos.

The server tries a public blob first and falls back to a signed URL when the
store refuses it, so either kind of store works untouched; set `BLOB_ACCESS` to
`public` or `private` to skip the probe.

## Project structure

```
src/config.ts          CLI/env configuration parsing
src/tools.ts           MCP tool definitions (JSON schema)
src/image-service.ts   Provider calls (OpenAI / Gemini) -> MCP content blocks
src/task-store.ts      In-memory async task queue
src/mcp-server.ts      MCP server factory: tool registration + dispatch
src/http-transport.ts  Streamable HTTP transport handler (stateless) + health payload
src/index.ts           CLI entry point (stdio / http / sse)
src/auth.ts            OAuth bearer verification + allow-list + metadata
src/uploads.ts         Image upload storage (Vercel Blob)
api/mcp.ts             Vercel serverless function -> /mcp
api/health.ts          Vercel serverless function -> /health
api/oauth-*.ts         Vercel serverless functions -> /.well-known/oauth-*
api/upload.ts          Vercel serverless function -> /api/upload
web/upload.html        Drag-and-drop upload page
web/index.html         Static landing page (Vercel output directory)
```

## Development

```bash
npm run build       # Compile to dist/
npm run typecheck   # Type-check src/ and api/
npm run watch       # Watch mode
npm test            # Unit tests
npm start           # Run the compiled server on stdio
npm run start:http  # Run the compiled server on http://localhost:3000/mcp
```

## Tech Stack

- `@modelcontextprotocol/sdk` — MCP SDK
- `@google/genai` — Google Gemini SDK
- `openai` — OpenAI SDK

## License

MIT
