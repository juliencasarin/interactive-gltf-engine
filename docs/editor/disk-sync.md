# Assets disk sync

**Status:** Implemented (`assets_disk_sync.py`, `assets_watch.py`).

## Purpose

When authors edit files under **`workspace/assets/`** with an external IDE (Cursor, VS Code), the backend watches the workspace and **merges disk state into `project.json`** without manual catalog edits.

## WebSocket watch

**Endpoint:** `WS /projects/{project_id}/assets/watch`

1. Client connects (editor opens watch when API available)
2. Server runs initial **`sync_assets_from_disk_async`**
3. Sends `{ channel: "assets_disk", payload: { hello: true, events: [...] } }`
4. Background **`watchfiles.awatch`** on workspace (debounce 300ms)
5. On change → sync → broadcast `{ channel: "assets_disk", payload: { events: [...] } }`

**Filtered paths:** `project.json`, `assets/*.{glb,gltf,js,mjs,cjs}` — not `build/`, `.git`, etc.

Watch task runs while **≥1 subscriber** connected.

## Sync algorithm (summary)

For each tracked file under `assets/`:

| Event | Action |
|-------|--------|
| New script | Infer `assetKind: script`, parse `export class` → `scriptExports`, default `scriptRole: interaction` |
| New glTF | Add catalog row with UUID `assetId` |
| UUID-named script | On parse success → migrate file stem toward class name |
| Deleted file | Remove catalog row; **scrub scene refs** (attachments, `assetRef`, mirror fields) |
| Modified script | Refresh `scriptExports` fingerprint |

Writes **`project.json`** atomically under per-project filesystem lock. Updates registry **`lastSavedAt`**.

## Frontend reaction

`EditorContext` applies returned events: refresh assets list, Inspector, dirty state. **`AssetsPanel`** shows connection hint.

## Interaction with Save

| Path | Orphan files in `assets/` |
|------|---------------------------|
| Disk sync | Adds catalog rows for new files |
| Editor **Save** (`PUT /document`) | **Deletes** catalog orphans + orphan top-level files |

Agents must not hand-edit `project.json` — [mcp-scene-authoring.md](mcp-scene-authoring.md).

## Related

- [assets-panel.md](assets-panel.md) — UI
- [http-api.md](http-api.md) — WebSocket route
- [project-persistence.md](project-persistence.md) — staging vs save
