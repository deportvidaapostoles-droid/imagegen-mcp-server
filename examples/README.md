# Example MCP Client Configuration

This directory contains example configuration files for using the Assets Generation MCP Server with various MCP clients.

## Claude Desktop Configuration

File: `claude_desktop_config.json`

Add this to your Claude Desktop configuration:

- **MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "assets-gen": {
      "command": "npx",
      "args": [
        "-y",
        "@ayaka209/assets-gen-mcp",
        "--openai-api-key",
        "your-openai-api-key-here",
        "--openai-base-url",
        "https://api.openai.com/v1",
        "--default-model",
        "gpt-image-2"
      ]
    }
  }
}
```

Replace:
- `your-openai-api-key-here` with your OpenAI API key (or remove this line if not using OpenAI)
- `--openai-base-url` is optional - only needed for custom endpoints (remove it to use the default OpenAI base URL)

You can also keep using `env` if your MCP client supports it. The server now supports all three:

1. `.env` in the current working directory
2. Process environment variables
3. CLI arguments like `--openai-api-key` and `--gemini-api-key`

Priority is: **CLI args > env > .env > built-in defaults**.

## Getting API Keys

### OpenAI API Key
1. Visit https://platform.openai.com/api-keys
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key (you won't be able to see it again!)

### Google Gemini API Key
1. Visit https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API key"
4. Copy the key

## Usage Examples

Once configured, you can ask Claude to:

- "Generate an image of a sunset over mountains using DALL-E 3"
- "Create an image of a futuristic city with DALL-E 2 in 512x512 size"
- "Generate an image using Gemini model of a cat playing piano"
- "Make an image with gemini-2.0-flash-exp in 16:9 aspect ratio showing a robot in a park"

The MCP server will automatically select the correct provider (OpenAI or Gemini) based on the model you specify, and handle the API calls to return the generated images.
