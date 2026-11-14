# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | Yes       |

## Offline by Design

OhMyFlow processes everything on your own machine:

- **Zero network requests for photo processing.** The only `fetch` calls in the
  codebase load the bundled ONNX model file (`models/ultraface-320.onnx`) and
  local app files through the internal `app://` protocol. No remote URLs exist
  anywhere in the source.
- **No API keys, no cloud, no telemetry, no analytics.** There is nothing to
  leak because nothing is collected or transmitted.
- **No runtime downloads.** The AI model and WebAssembly runtime ship inside
  the app package. The app never downloads code or models at runtime.

## Renderer Isolation

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The UI cannot
  touch the disk or Node APIs directly.
- All disk access goes through a minimal `contextBridge` surface (`window.ohmyflow`)
  handled by the main process, with local path and `app:getPath` allowlist validation.
- The renderer is served over a custom `app://` protocol (not `file://`) with
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, and a strict
  `Content-Security-Policy` (`default-src 'self' app:; script-src 'self' 'wasm-unsafe-eval'`).
  The handler only serves files inside `dist/` (traversal blocked via `path.relative`, GET only).
- Packaged disk caches (`thumbs/`, `analysis/`) are bounded by LRU size and age pruning.

## File Safety

- **Originals are never modified, moved, or deleted** during scanning or culling.
- Exporting files requires an explicit destination picked by you in a folder
  dialog, shows the file count first, carries RAW+JPG pairs along,
  and auto-numbers name collisions.
- Personal photo folders, build output, logs, and secrets are git-ignored and
  excluded from the packaged app.

## AI Model Supply Chain

- Face model: UltraFace RFB-320 (MIT licensed), bundled at
  `public/models/ultraface-320.onnx` with a recorded SHA-256 checksum that is
  verified when the model loads. A mismatch counts as a load failure.
- If the model or WebAssembly runtime fails to load — including a checksum
  mismatch — the app silently falls back to the built-in heuristics. A model
  failure can never crash culling.

## Reporting a Vulnerability

Open a GitHub issue at <https://github.com/0xMinomus/OhMyFlow/issues> with
`[security]` in the title and a clear description plus steps to reproduce.
Please do not include other people's private photos in reports.
