# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | Yes       |

## Offline by Design

OhMyFlow processes everything on your own machine:

- **Zero network requests for photo processing.** The application never contacts
  any external server or cloud service. No remote URLs exist in the codebase.
- **No API keys, no cloud, no telemetry, no analytics.** There is nothing to
  leak because nothing is collected or transmitted.
- **No runtime downloads.** The AI model (`UltraFace RFB-320`) is embedded directly
  into the native executable binary at compile time (`include_bytes!`). The app
  never downloads code or models at runtime.

## Tauri 2 Architecture & Process Isolation

- **No Node.js runtime in production.** The application backend is 100% native Rust
  using Tauri 2, eliminating Node.js process vulnerabilities and Electron runtime overhead.
- **IPC isolation.** The webview frontend only communicates with the Rust backend
  through strictly allowed Tauri IPC commands registered in `src-tauri/capabilities/default.json`.
- **Custom `media://` protocol security.** Full-resolution previews and thumbnails are served
  via a custom streaming protocol strictly guarded by `is_path_inside_roots`: only files
  inside explicitly scanned folders are accessible. Path traversal attempts (`..`, sibling prefixes)
  are rejected with HTTP 403 Forbidden.
- **Strict Content Security Policy (CSP).** The webview enforces a strict CSP in `tauri.conf.json`:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' media: http://media.localhost https://media.localhost data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
- **Bounded disk cache.** The thumbnail and session caches in the app data/cache directories
  are pruned automatically using LRU size (max 250 MB / 50 MB) and age (14 days / 30 days) limits.

## File Safety

- **Originals are never modified, moved, or deleted** during scanning or culling.
- Exporting files requires an explicit destination picked by you in a native folder
  dialog, shows the file count first, carries RAW+JPG pairs along,
  and auto-numbers name collisions.
- Personal photo folders, build output, logs, and secrets are git-ignored and
  excluded from packaged builds.

## AI Model Supply Chain

- Face model: UltraFace RFB-320 (MIT licensed), embedded into the binary at
  compile time with a recorded SHA-256 checksum (`34CD7E60AEFF28744C657DE7A3DC64E872D506741DE66987F3426F2B79F88017`)
  that is verified upon initial execution. A mismatch counts as a load failure.
- If the model fails to load — including a checksum mismatch — the app silently
  falls back to the built-in heuristics. A model failure can never crash culling.

## Reporting a Vulnerability

Open a GitHub issue at <https://github.com/0xMinomus/OhMyFlow/issues> with
`[security]` in the title and a clear description plus steps to reproduce.
Please do not include other people's private photos in reports.
