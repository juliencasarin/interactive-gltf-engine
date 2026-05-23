# Configuration — environment variables

## Backend (`igltf-editor-backend`)

Loaded from **`igltf-editor-backend/.env`** (via `python-dotenv` at startup).

| Variable | Default | Purpose |
|----------|---------|---------|
| `STORAGE_ROOT` | — | Writable app data dir (with `IGLTF_APP_DATA_DIR`, first wins) |
| `IGLTF_APP_DATA_DIR` | `./data` (under backend) | Registry host: **`projects.json`** lives here |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8000` | Absolute URLs in API responses, `mcp.json`, Play manifest |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated frontend origins |
| `MAX_UPLOAD_MB` | `200` | Max glTF upload size (stage) |
| `MAX_SCRIPT_UPLOAD_MB` | `8` | Max script upload size (stage) |
| `ESBUILD_BINARY` | — | Optional path to `esbuild` executable |
| `IGLTF_AUTHORING_KIT` | bundled kit | Override MCP authoring kit root |
| `IGLTF_AUTHORING_READ_MAX_BYTES` | `524288` | MCP read cap per framework file |

**Project resolution:** API `project_id` → registry `diskPath`, or legacy slug folder under app data dir. UUID ids unknown to registry return 400.

## Frontend (`igltf-editor-frontend`)

Vite env (`.env`, `.env.local`):

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Backend REST/WS base (no trailing slash). Unset → offline/local JSON mode |
| `VITE_OPEN_IN_IDE` | When `true`, show Open in IDE controls (requires same-machine API) |

Build-time: **`VITE_APP_VERSION`** from `package.json` (via `vite.config.ts`).

## Desktop (Tauri)

- **`tauri:dev`** spawns `uv run uvicorn` against sibling backend
- PyInstaller bundle includes esbuild for Play builds inside desktop app

See [../tauri-build/README.md](../tauri-build/README.md).
