# Changelog

## [0.1.4] — 2026-04-30

### Fixed

- **`response_format: "url"` now works for gpt-image models** — previously gpt-image-1/2 ignored the `response_format` parameter entirely; now it is correctly forwarded to the OpenAI API.
- **Image URLs are no longer silently discarded** — when the API returns a `url` response, the URL is included as `Image URL: https://...` text in the MCP response so the caller can access it.

### Added

- **Automatic temp-file fallback for `response_format: "url"`** — when `response_format` is `"url"` but the API returns only base64 data (common with some proxies or Gemini), the image is automatically saved to `os.tmpdir()` with a cryptographically random filename. The response includes `Saved to: /path/to/file.png`.
- **Proper file extensions** — saved images use the correct extension (`.png`, `.jpg`, `.webp`, etc.) based on the MIME type.

## [0.1.3] — 2025-12-10

Initial public release.
