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
      "command": "node",
      "args": ["/absolute/path/to/assets-gen-mcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key-here",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "GEMINI_API_KEY": "your-gemini-api-key-here"
      }
    }
  }
}
```

Replace:
- `/absolute/path/to/assets-gen-mcp` with the actual path to your cloned repository
- `your-openai-api-key-here` with your OpenAI API key (or remove this line if not using OpenAI)
- `OPENAI_BASE_URL` is optional - only needed for custom endpoints like Azure OpenAI (or remove this line to use default)
- `your-gemini-api-key-here` with your Google Gemini API key (or remove this line if not using Gemini)

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
