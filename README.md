# Assets Generation MCP Server

An MCP (Model Context Protocol) server for AI-powered image generation. Supports multiple providers including OpenAI's DALL-E and Google's Gemini Imagen models.

## Features

- 🎨 **Multiple Providers**: Support for OpenAI DALL-E and Google Gemini
- 🤖 **Auto-Detection**: Automatically selects the correct provider based on the model name
- 🔧 **Flexible Configuration**: Customize model, size, quality, and other parameters
- 🚀 **Easy Integration**: Works seamlessly with MCP-compatible clients
- 🔑 **Secure**: API keys managed through environment variables

## Supported Tool

### `generate_image` - Unified Image Generation

Generate images using AI models. The provider (OpenAI or Gemini) is automatically selected based on the model parameter.

**Supported Models:**
- **OpenAI**: `dall-e-2`, `dall-e-3` (default)
- **Gemini**: `gemini-2.0-flash-exp`, `imagen-3.0-generate-001`

**Parameters:**
- `prompt` (required): Text description of the desired image
- `model` (optional): Model name (default: "dall-e-3")
  - OpenAI models: "dall-e-2", "dall-e-3"
  - Gemini models: "gemini-2.0-flash-exp", "imagen-3.0-generate-001"
- `size` (optional, OpenAI only): Image size
  - DALL-E 3: "1024x1024", "1792x1024", "1024x1792"
  - DALL-E 2: "256x256", "512x512", "1024x1024"
- `quality` (optional, OpenAI only): "standard" or "hd" (DALL-E 3 only)
- `n` (optional): Number of images to generate
  - OpenAI: 1-10 for DALL-E 2, must be 1 for DALL-E 3
  - Gemini: must be 1
- `aspect_ratio` (optional, Gemini only): "1:1", "3:4", "4:3", "9:16", or "16:9"
  - Note: Aspect ratio is included in the prompt since it's not directly supported by the SDK API

**Returns:** 
- OpenAI: JSON with image URLs and revised prompts
- Gemini: JSON with base64-encoded image data or text response if model doesn't support image generation

**Note**: Image generation in Gemini requires specific model access. The experimental `gemini-2.0-flash-exp` model may support image generation, but availability varies by API key and region.

## Installation

```bash
npm install
npm run build
```

## Configuration

Set up your API keys as environment variables:

```bash
# For OpenAI DALL-E support
export OPENAI_API_KEY="your-openai-api-key"

# Optional: Override OpenAI API base URL (e.g., for Azure OpenAI or proxies)
export OPENAI_BASE_URL="https://your-custom-endpoint.com/v1"

# For Google Gemini support
export GEMINI_API_KEY="your-gemini-api-key"

# Optional: Override Gemini API base URL (note: not fully supported in current SDK)
export GEMINI_BASE_URL="https://your-custom-endpoint.com"
```

You can enable one or both providers by setting the corresponding API keys.

### Custom Base URLs

You can override the default API endpoints:

- **OpenAI**: Set `OPENAI_BASE_URL` to use Azure OpenAI, proxy servers, or custom endpoints
- **Gemini**: Set `GEMINI_BASE_URL` (limited support - may require SDK updates for full functionality)

## Usage

### With Claude Desktop

Add this to your Claude Desktop configuration file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "assets-gen": {
      "command": "node",
      "args": ["/absolute/path/to/assets-gen-mcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "GEMINI_API_KEY": "your-gemini-api-key"
      }
    }
  }
}
```

**Note:** The `OPENAI_BASE_URL` is optional and only needed if you want to use a custom endpoint (e.g., Azure OpenAI or a proxy).

### With MCP Client

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/path/to/assets-gen-mcp/dist/index.js"],
  env: {
    OPENAI_API_KEY: "your-openai-api-key",
    GEMINI_API_KEY: "your-gemini-api-key",
  },
});

const client = new Client({
  name: "example-client",
  version: "1.0.0",
}, {
  capabilities: {},
});

await client.connect(transport);
```

## Examples

### Generate an image with DALL-E 3

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "A serene mountain landscape at sunset with a lake reflection",
    "model": "dall-e-3",
    "size": "1024x1024",
    "quality": "hd"
  }
}
```

### Generate an image with DALL-E 2

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "A futuristic city skyline",
    "model": "dall-e-2",
    "size": "512x512",
    "n": 2
  }
}
```

### Generate an image with Gemini

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "A cute robot playing with a puppy in a park",
    "model": "gemini-2.0-flash-exp",
    "aspect_ratio": "16:9"
  }
}
```

**Note**: The tool automatically detects the provider based on the model name. Gemini image generation support depends on your API key's access level and the specific model's capabilities.

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Watch mode for development
npm run watch
```

## API References

- [OpenAI Image Generation API](https://platform.openai.com/docs/guides/image-generation)
- [Google Gemini Image Generation](https://ai.google.dev/gemini-api/docs/image-generation)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
