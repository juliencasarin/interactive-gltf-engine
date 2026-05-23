# Getting started

**Status:** Milestone 1 reference implementation (POC). See [docs/milestone-1-scope.md](docs/milestone-1-scope.md) for limits.

## Prerequisites

| Tool | Version | Used for |
|------|---------|----------|
| **Node.js** + npm | LTS | Frontend, esbuild (Play bundle) |
| **Python** | 3.12+ | Backend API |
| **[uv](https://docs.astral.sh/uv/)** | current | Python deps and dev server |
| **Rust + MSVC** | optional | Desktop app only ([tauri-build/README.md](tauri-build/README.md)) |

Clone **[interactive-gltf-specs](https://github.com/UMI3D/interactive-gltf-specs)** alongside this repo if you work on portable format alignment — not required to run the editor.

## 1. Backend

```powershell
cd igltf-editor-backend
copy .env.example .env
uv sync --extra dev
npm install
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API: `http://127.0.0.1:8000`
- Health: `GET /health` → `engineVersion`, `mcpPath`
- MCP: `http://127.0.0.1:8000/mcp`

Env reference: [docs/configuration.md](docs/configuration.md).

## 2. Frontend (browser)

```powershell
cd igltf-editor-frontend
copy .env.example .env
npm ci
npm run dev
```

Open `http://localhost:5173`.

`VITE_API_BASE_URL` must match the backend (default `http://127.0.0.1:8000`).

## 3. First project workflow

1. **Projects hub** (`/`) → **New project** (pick a parent folder and name).
2. **Editor** opens → **Import** a `.glb` into Assets (or drag onto the assets panel).
3. Drag the asset from Assets into the **preview** to place it in the scene.
4. Optional: create an **interaction script** from Assets (template), attach it in the **Inspector**.
5. **Save** (toolbar or Ctrl+S).
6. **Build & Play** → merged `build/scene.glb` (+ `build/scene.js` if scripts exist) → **Play** view.

Hub **Compile** can build Play output without keeping the editor open.

## 4. MCP + Cursor (optional)

1. Keep the **editor open** on the project.
2. **Settings → Allow scene edition** if agents should mutate the scene.
3. Open the **workspace folder** in Cursor (not the API URL alone).
4. Point MCP at `http://127.0.0.1:8000/mcp` (or use generated `mcp.json` in the workspace).

Details: [docs/editor/mcp-scene-authoring.md](docs/editor/mcp-scene-authoring.md).

## 5. Desktop app (optional, Windows)

From repo root:

```powershell
.\tauri-build\build.bat
```

Dev shell: `cd igltf-editor-frontend && npm run tauri:dev`

See [tauri-build/README.md](tauri-build/README.md).

## Troubleshooting

| Issue | Check |
|-------|--------|
| Hub empty / API errors | Backend running; `VITE_API_BASE_URL` set |
| Play 404 | Run **Build & Play** or hub **Compile** first |
| MCP cannot mutate scene | Editor open; Settings → Allow scene edition |
| Script bundle fails | `npm install` in `igltf-editor-backend/` (esbuild) |

## Next steps

- Product docs: [docs/README.md](docs/README.md)
- API reference: [docs/editor/http-api.md](docs/editor/http-api.md)
- Portable format: **interactive-gltf-specs** proposals and specifications
