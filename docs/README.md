# docs

`photo-drop.artifact.html` is the source of the **Photo Drop** page published as a
Claude Artifact. It is not served by Vercel and will not work as a plain static
file: it calls `claude.use("mcp")`, which only resolves inside Claude, and it
reaches this server through the viewer's own `Image MCP` connector rather than
over the network.

It exists because `upload_image` is slow when the *model* has to write the
base64 out token by token. Called from page JavaScript the same tool is fast, so
the page reads the file itself, shrinks anything over 900 KB to 2048 px on the
long edge, and calls the tool directly.

To republish after editing, publish this file as an Artifact with:

```json
{ "mcp": { "servers": [{ "server": "Image MCP", "tools": ["upload_image"] }] } }
```

Pages that declare the `mcp` capability cannot be shared publicly.
The browser-only equivalent, with no connector involved, is `web/upload.html`
(served at `/u`).
