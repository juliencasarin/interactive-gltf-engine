# Desktop packaging — Tauri + PyInstaller backend

Production desktop builds bundle **interactive glTF Editor** (`igltf-editor-frontend` + embedded FastAPI from `igltf-editor-backend`).

## Prerequisites (developer machine — Windows)

- **Rust** toolchains + **MSVC** (Visual Studio Build Tools with C++ workloads).
- **Node.js**, **npm** (lockfile: `npm ci` in CI).
- **WebView2** runtime on target machines (typical on recent Windows).
- **`uv`** and **Python ≥ 3.12** — for `uvicorn` development and for freezing the backend (`pyinstaller`).
- **[NSIS](https://nsis.sourceforge.io/Main_Page)** — **`makensis` on `PATH`** so `tauri build` can emit a **single-file `setup.exe`**.

## One-shot desktop build (`build.bat`)

From the **`interactive-gltf-engine` repo root**:

```powershell
.\tauri-build\build.bat
```

This sequence:

1. `npm ci` (esbuild for **`build/scene.js`**) + `uv sync --extra packaging` + **PyInstaller** `scripts\igltf-backend.spec` → outputs the **onedir** backend under `igltf-editor-frontend\resources\igltf-backend\` (includes bundled **esbuild**).
2. `npm ci`, **clean** `igltf-editor-frontend\src-tauri\target\release` (drops stale binaries such as a previous `app.exe`), then `npm run tauri build` → **`igltf-editor.exe`** + **`nsis`** installer when NSIS is installed.

Typical outputs include an unpacked `release` directory and a **`setup.exe`** (use the installer as the user-facing download).

Do **not** commit generated `resources/igltf-backend/*` binaries (see `igltf-editor-frontend/.gitignore`).

## Windows: native shell drag-drop vs HTML5 drag-drop

On Windows, **WebView2 cannot mix** Tauri’s **window-level file drop** hook with the browser’s **HTML5 drag and drop** (`dragover` / `drop` in the page). If the default is left on, **in-app** drags (e.g. catalog → scene, hierarchy reorder) may show a “not allowed” cursor and never drop, while the same UI works in a normal browser on `http://localhost:5173`.

The Tauri config sets **`dragDropEnabled: false`** on the main window in `igltf-editor-frontend/src-tauri/tauri.conf.json` so **HTML5 DnD works** inside the shell. That **turns off** Tauri’s built-in **OS file** drop path for that window until a separate approach is wired (e.g. Tauri APIs or a hybrid only if the platform allows it). Maintainer note: [Tauri issue #13171](https://github.com/tauri-apps/tauri/issues/13171). The same trade-off is spelled out in **`WindowConfig.dragDropEnabled`** in `@tauri-apps/cli`’s `config.schema.json`.

## Version bumps

Keep these three aligned before tagging a release:

- `igltf-editor-frontend/package.json` → **`version`**
- `igltf-editor-frontend/src-tauri/Cargo.toml` → **`version = "…"`** (`[package]` block)
- `igltf-editor-frontend/src-tauri/tauri.conf.json` → **`version`**

Script:

```powershell
.\tauri-build\bump-version.ps1 patch
.\tauri-build\bump-version.ps1 minor
.\tauri-build\bump-version.ps1 -Explicit "1.4.5"
```

`vite.config.ts` defines **`import.meta.env.VITE_APP_VERSION`** from `package.json` when needed in the UI.

## Development

- Backend: [`../igltf-editor-backend/README.md`](../igltf-editor-backend/README.md)
- Frontend: [`../igltf-editor-frontend/README.md`](../igltf-editor-frontend/README.md)
- **In the desktop shell:** `npm run tauri:dev` from `igltf-editor-frontend`; Rust starts **`uv run uvicorn`** against the sibling backend repo.

Tauri reference: [https://v2.tauri.app/](https://v2.tauri.app/)
