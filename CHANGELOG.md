# Changelog

## [0.1.6] — 2026-05-07

### Changed

- **`response_format: "auto"` now always saves images to temporary files** — both OpenAI-compatible and Gemini paths. Previously, `auto` only returned `ImageContent` blocks. Now `auto` behaves like a safer default: it persists every image to `os.tmpdir()` with a cryptographically random filename, then returns `Saved to: /path/to/file.png` alongside the base64 `ImageContent`. This ensures callers always have a local file path regardless of the provider's default response format.

### Updated

- Tool description for `response_format` updated to clarify that `auto` saves to a temporary local file and returns both the path and the inline image.
- README / README.zh-CN updated to reflect the new `auto` behavior.

## [0.1.5] — 2026-04-30

### Fixed

- **Precise url-mode fallback** — the `response_format: "url"` guard only accepts explicit `Image URL:` or `Saved to:` text blocks, preventing false-positive responses from Revised prompt or warning text.
- **Error propagation in non-url modes** — `openAIImageToBase64` conversion failures are only swallowed in url mode when a URL was already surfaced; other modes rethrow to preserve the root cause.
- **Exclusive-create (`wx`) flag** — temp files now use `{ flag: "wx", mode: 0o600 }` to prevent overwrite attacks and restrict permissions to owner-only.

### Added

- **Unit tests for `saveBase64ToTempFile`** — 7 tests covering PNG/JPEG/WebP extensions, unknown MIME fallback, random filename format, wx collision guard, and file permissions.

## [0.1.4] — 2026-04-30

### Fixed

- **`response_format: "url"` now works for gpt-image models** — previously gpt-image-1/2 ignored the `response_format` parameter entirely; now it is correctly forwarded to the OpenAI API.
- **Image URLs are no longer silently discarded** — when the API returns a `url` response, the URL is included as `Image URL: https://...` text in the MCP response so the caller can access it.

### Added

- **Automatic temp-file fallback for `response_format: "url"`** — when `response_format` is `"url"` but the API returns only base64 data (common with some proxies or Gemini), the image is automatically saved to `os.tmpdir()` with a cryptographically random filename. The response includes `Saved to: /path/to/file.png`.
- **Proper file extensions** — saved images use the correct extension (`.png`, `.jpg`, `.webp`, etc.) based on the MIME type.

## [0.1.3] — 2025-12-10

Initial public release.
