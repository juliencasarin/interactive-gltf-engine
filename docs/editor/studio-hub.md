# Studio hub — projects registry

**Status:** Implemented.

## Purpose

The **Projects hub** (`/` in the frontend) lists registered workspaces. Each row is a **UUID** mapped to an on-disk folder via **`projects.json`** on the API host.

Workspaces may live **anywhere on disk** — not only under app data.

## Registry file

Path: **`{STORAGE_ROOT or IGLTF_APP_DATA_DIR}/projects.json`**

```json
{
  "version": 1,
  "projects": [
    {
      "id": "uuid",
      "diskPath": "C:/Users/…/MyProject",
      "lastSavedAt": "2026-05-23T10:00:00Z",
      "savedWithEngineVersion": "0.1.0"
    }
  ]
}
```

- **`lastSavedAt`** / **`savedWithEngineVersion`** updated on successful **`PUT /document`**
- Atomic write via temp file + replace (`projects_registry.py`)

## Hub UI flows

| Action | API | Result |
|--------|-----|--------|
| Refresh list | `GET /studio/projects` | Table: name, path, last saved, engine version |
| **New project** | `POST /studio/projects/create` | Pick parent folder (native dialog on desktop), enter folder name → navigate to `/editor/{id}` |
| **Open existing** | `POST /studio/projects/register` | Pick existing workspace folder → register + open editor |
| **Edit** | — | Navigate to `/editor/{id}` |
| **Play** | `GET /play/{id}` (after build) | Opens `/play/{id}` in new context |
| **Compile** | `POST /build-play-glb` | Build bundle from disk `project.json` (no editor required) |
| **Remove from hub** | `DELETE /studio/projects/{id}` | Unregister only; files remain on disk |

Desktop: Tauri folder picker when available; otherwise manual path entry.

## New project layout

Created by **`POST /studio/projects/create`**:

```text
{parent}/{folderName}/
  assets/
  _staging/
  .gitignore          # ignores build/
  mcp.json            # on first ensure_project_layout
  .igltf/project-id
  .cursor/rules/…
```

`project.json` appears on first **Save** in the editor (or first `PUT /document`).

## Legacy slug projects

If `project_id` is **not** a registered UUID and **not** UUID-shaped, API resolves **`{app_data}/{project_id}/`** (legacy POC folders like `test`).

## Identity for MCP

- Hub UUID = route param in all `/projects/{id}/…` URLs
- Workspace file **`.igltf/project-id`** mirrors UUID for `igltf_resolve_project_id`
- **Settings → MCP project id** shows the same UUID

## Related

- [http-api.md](http-api.md) — REST routes
- [project-persistence.md](project-persistence.md) — document + assets
- [mcp-scene-authoring.md](mcp-scene-authoring.md) — resolve project id
