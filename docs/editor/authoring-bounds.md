# Authoring bounds

**Status:** Implemented (schema + MCP + viewport measure). **No Inspector UI button** yet.

## Purpose

**Editor-only** metadata (`authoringBounds`) stores axis-aligned box + bounding sphere for scale/collision tooling and MCP discovery. **Not exported** to Play glTF.

Schema: [igltf-editor-project.md](igltf-editor-project.md).

## Measurement pipeline

1. **Viewport** — Three.js scene registry tracks loaded meshes per node/asset (`authoringBounds.ts`, `editorViewportBounds.ts`)
2. **MCP read** — `igltf_get_bounds_metadata` returns stored metadata from live session snapshot
3. **MCP measure** — `igltf_measure_scene_node_bounds` / `igltf_measure_scene_subtree_bounds` / `igltf_measure_asset_bounds`:
   - Computes AABB + sphere from viewport (`space`: `local` | `world` for nodes)
   - `igltf_compare_bounds` — delta center/size, distance, volume ratio between two measured targets
   - `persist: false` → return only (read-like)
   - `persist: true` → writes to node/asset in live session (**requires Allow scene edition**)
4. **MCP camera** — `igltf_get_viewport_camera_summary` (pose + visible roots; no image capture)

## Storage shape

```json
{
  "space": "local",
  "aabb": { "min": […], "max": […], "center": […], "size": […] },
  "sphere": { "center": […], "radius": 1.0 },
  "measuredAt": "2026-05-23T12:00:00Z"
}
```

Assets typically use **`local`** space; scene nodes may use **`world`**.

## UI status

| Surface | Measure | Persist |
|---------|---------|---------|
| MCP tools | Yes | Yes (`persist: true`) |
| Inspector | **No** | — |
| Export | **Stripped** | — |

Future: Inspector button may call same path as MCP measure.

## Related

- [mcp-scene-authoring.md](mcp-scene-authoring.md) — measure tools
- [editor-session-protocol.md](editor-session-protocol.md) — live session commands
