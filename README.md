# Assets Generation MCP Server

An MCP (Model Context Protocol) server for AI-powered image generation. Supports multiple providers including OpenAI's DALL-E and Google's Gemini Imagen models.

## Features

- 🎨 **Multiple Providers**: Support for OpenAI DALL-E and Google Gemini
- 🔧 **Flexible Configuration**: Customize model, size, quality, and other parameters
- 🚀 **Easy Integration**: Works seamlessly with MCP-compatible clients
- 🔑 **Secure**: API keys managed through environment variables

## Supported Tools

### 1. OpenAI DALL-E Image Generation (`generate_image_openai`)

Generate images using OpenAI's DALL-E models (DALL-E 2 and DALL-E 3).

**Parameters:**
- `prompt` (required): Text description of the desired image
- `model` (optional): "dall-e-2" or "dall-e-3" (default: "dall-e-3")
- `size` (optional): Image size
  - DALL-E 3: "1024x1024", "1792x1024", "1024x1792"
  - DALL-E 2: "256x256", "512x512", "1024x1024"
- `quality` (optional): "standard" or "hd" (DALL-E 3 only)
- `n` (optional): Number of images (1-10 for DALL-E 2, must be 1 for DALL-E 3)

**Returns:** JSON with image URLs and revised prompts

### 2. Google Gemini Image Generation (`generate_image_gemini`)

Generate images using Google's Gemini Imagen models.

**Parameters:**
- `prompt` (required): Text description of the desired image
- `model` (optional): Model name (default: "imagen-3.0-generate-001")
- `number_of_images` (optional): Number of images to generate (1-4, default: 1)
- `aspect_ratio` (optional): "1:1", "3:4", "4:3", "9:16", or "16:9" (default: "1:1")

**Returns:** JSON with base64-encoded image data

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

# For Google Gemini support
export GEMINI_API_KEY="your-gemini-api-key"
```

You can enable one or both providers by setting the corresponding API keys.

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
        "GEMINI_API_KEY": "your-gemini-api-key"
      }
    }
  }
}
```

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
  "name": "generate_image_openai",
  "arguments": {
    "prompt": "A serene mountain landscape at sunset with a lake reflection",
    "model": "dall-e-3",
    "size": "1024x1024",
    "quality": "hd"
  }
}
```

### Generate an image with Gemini

```json
{
  "name": "generate_image_gemini",
  "arguments": {
    "prompt": "A cute robot playing with a puppy in a park",
    "aspect_ratio": "16:9",
    "number_of_images": 2
  }
}
```

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
