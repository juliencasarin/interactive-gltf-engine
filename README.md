# interactive-gltf-engine

This editor and runtime POC implements [**interactive-gltf**](https://github.com/UMI3D/interactive-gltf-specs): a **reprise** of the **3D interaction design pattern** introduced by **[UMI3D](https://github.com/UMI3D)** in a **web-compatible glTF** form, with the progressive ambition to author **3D engine- and device-agnostic** interactive content.

The UMI3D protocol was defined in Julien Casarin’s thesis (2019, Université de Strasbourg), supervised by **Professor Dominique Bechmann** and **Jean-François Gaudy**, in collaboration with the **IGG** team at the **ICube** laboratory:

- **Français (document source) :** [*Proposition d'un protocole web pour la collaboration multi-support en environnement 3D : UMI3D*](https://theses.hal.science/tel-02518604/)
- **English title (informative):** *Proposal for a web protocol for multi-support collaboration in 3D environment: UMI3D*

Reference open-source repositories: **[github.com/UMI3D](https://github.com/UMI3D)** — notably [UMI3D-SDK](https://github.com/UMI3D/UMI3D-SDK), [UMI3D-BROWSER](https://github.com/UMI3D/UMI3D-BROWSER), and [UMI3D-Sketcher](https://github.com/UMI3D/UMI3D-Sketcher).

**Acknowledgement.** **interactive-gltf** and **igltf-editor** also build on more than a decade of research and product engineering by the **XR team at Inetum** (2015–2026): protocol design, SDK, browsers, Sketcher, and production collaborative 3D systems. **None of this would exist without that work.** Personally, I thank every member of my team for the amazing work. This repository implements that design pattern on **glTF** (authoring, Play, MCP)—step by step toward interactive 3D content that stays **3D engine- and device-agnostic**.

> **Status:** Milestone 1 (POC). No authentication, not production-hardened. See [docs/milestone-1-scope.md](docs/milestone-1-scope.md).

## Core principles

> **Compose glTF. Script behaviour. Ship one bundle. Build with AI at the scene.**

| | Principle | What it means |
|---|-----------|---------------|
| **1** | **One merged glTF** | Import `.glb` / `.gltf` assets, arrange them in a scene graph, **export a single `build/scene.glb`** — geometry, materials, nodes, and interaction metadata in one portable file. |
| **2** | **JavaScript for interactivity** | Behaviours live in **JavaScript**, not in a proprietary DSL. Edit in **Monaco**, attach scripts to nodes, bundle to **`build/scene.js`**. The language and host API are specified in [**interactive-gltf-specs**](https://github.com/UMI3D/interactive-gltf-specs). |
| **3** | **UMI3D interaction pattern → glTF** | Tools, interactables, and interaction handlers follow the **UMI3D design pattern**, serialized as **glTF extensions** — the same mental model, a **web-native, engine-portable** asset. |
| **4** | **Born in vibe coding** | **MCP-first** authoring: Cursor and other agents connect to a **live editor session**, inspect the scene, and **mutate hierarchy, transforms, and scripts** through typed tools — not by patching JSON on disk. See [docs/editor/mcp-scene-authoring.md](docs/editor/mcp-scene-authoring.md). |
| **5** | **Author → Build → Play** | Sketcher-inspired **web editor** (hierarchy, viewport, inspector, assets), **Build** to export, **Play** in the browser (or **Windows desktop** via Tauri) with real pointer interactions and script lifecycle. |
| **6** | **Engine- and device-agnostic output** | The deliverable is **standard glTF + JS**, not a single-vendor runtime lock-in. Author once; target web today, other engines and devices as runtimes adopt the format. |

**In one line:** igltf-editor is where **3D assets become interactive products** — merged glTF, scripted logic, AI-assisted scene work, and a path toward **cross-engine** delivery.

## What you get today

- **igltf-editor** — web UI: project hub, scene hierarchy, Three.js preview, asset catalog, Monaco script editor, MCP-friendly live session
- **Backend API** — FastAPI: `project.json` persistence, asset staging, Play bundle export (`build/scene.glb` + `scene.js`), MCP tools
- **Play** — load merged glTF + scripts; interaction handlers and `GLTF` host transactions
- **Desktop (Windows)** — optional Tauri + embedded backend ([tauri-build/README.md](tauri-build/README.md))

Portable **format** definitions (glTF extensions, JS scripting language) live in the separate **[interactive-gltf-specs](https://github.com/UMI3D/interactive-gltf-specs)** repository. This repo is the **product** that implements and often leads that standard.

```
interactive-gltf-specs          interactive-gltf-engine (this repo)
  proposals / specifications  ←→   editor + backend + Play + docs/
  portable format truth            full implemented behaviour
```

## Quick start

**[GETTING_STARTED.md](GETTING_STARTED.md)** — install backend + frontend, create a project, Build & Play.

```powershell
# Terminal 1 — backend
cd igltf-editor-backend
copy .env.example .env
uv sync --extra dev && npm install
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — frontend
cd igltf-editor-frontend
copy .env.example .env
npm ci && npm run dev
```

Open `http://localhost:5173`.

## Documentation

| Document | Audience |
|----------|----------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | First run |
| [docs/README.md](docs/README.md) | Full doc index |
| [docs/editor/](docs/editor/) | Product specs (schema, API, UI, MCP) |
| [ROADMAP.md](ROADMAP.md) | What comes next |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [docs/public-release-checklist.md](docs/public-release-checklist.md) | Maintainer checklist before GitHub publish |

## Repository layout

| Directory | Role |
|-----------|------|
| [igltf-editor-frontend/](igltf-editor-frontend/) | React app: hub, editor, Play |
| [igltf-editor-backend/](igltf-editor-backend/) | FastAPI, MCP, export pipeline |
| [tauri-build/](tauri-build/) | Desktop packaging |
| [docs/](docs/) | Engineering documentation |
| [igltf-engine/](igltf-engine/) | Standalone runtime package (deferred) |
| [igltf-editor-core/](igltf-editor-core/) | Shared Python library (deferred) |

## License

[Apache License 2.0](LICENSE)
