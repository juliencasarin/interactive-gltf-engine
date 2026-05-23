# `igltf-editor-project` document schema (v2)

**Status:** Implemented (`igltf-editor-backend/app/models.py`, frontend `types.ts`).  
**Export:** Fields marked **editor-only** are **not** written to Play glTF.

## Root document

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `format` | `"igltf-editor-project"` | yes | Discriminator |
| `version` | `2` | yes | v1 (inline `gltfDataUrl`) supported for import only |
| `scene` | object | yes | `{ "nodes": SceneNode[] }` — flat list, tree via `parentId` |
| `assets` | array | yes | Catalog of `.glb` and script files under `assets/` |
| `assetFolders` | string[] | no | Logical folder labels for the Assets panel |
| `editorSettings` | object | no | **Editor-only** — see below |

Pydantic models ignore unknown keys (`extra: ignore`).

## `editorSettings` (editor-only)

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `mcpAllowSceneEdition` | boolean | effective **`false`** | When `true`, MCP mutation tools may change the **live** scene while the editor session is connected |

See [mcp-scene-authoring.md](mcp-scene-authoring.md).

## `assets[]` — catalog entry

| Field | Type | Export | Meaning |
|-------|------|--------|---------|
| `assetId` | string (UUID) | — | Stable catalog id; referenced by `scene.nodes[].assetRef`, script refs |
| `relativePath` | string | yes (as URI) | Path under workspace, e.g. `assets/MyHandler.js` |
| `name` | string | — | Display name in Assets panel |
| `description` | string | — | **Editor-only** — MCP / collaborator hint |
| `authoringBounds` | object | — | **Editor-only** — measured model-local bounds |
| `logicalFolder` | string | — | Assets panel grouping |
| `assetKind` | `"gltf"` \| `"script"` | maps to export | Discriminator |
| `scriptRole` | `"interaction"` \| `"behaviour"` | maps to `scripts[]` | Script lifecycle role |
| `interactionKind` | string | maps to proto `dto.interactionType` | Template: `event`, `link`, `form`, `manipulation`, `drawing` |
| `scriptExports` | string[] | handler id | Exported class / callback names (first entry is primary) |
| `scriptDependsOnAssetIds` | string[] | bundle order | DAG edges for esbuild topological sort |

### `authoringBounds` (nodes and assets)

| Field | Type | Meaning |
|-------|------|---------|
| `space` | `"local"` \| `"world"` | `local` for assets; nodes may use `world` |
| `aabb` | `{ min, max, center, size }` | Each `[x,y,z]` |
| `sphere` | `{ center: [x,y,z], radius }` | Bounding sphere |
| `measuredAt` | string (ISO-8601) | Optional viewport measurement time |

## `scene.nodes[]` — scene row

| Field | Type | Export | Meaning |
|-------|------|--------|---------|
| `id` | string | — | Stable authoring id (UUID) |
| `name` | string | glTF node name | Hierarchy label |
| `description` | string | — | **Editor-only** semantic hint |
| `authoringBounds` | object | — | **Editor-only** measured bounds |
| `parentId` | string \| null | parent index | `null` = scene root |
| `position` | `[x,y,z]` | yes | Local translation; mirror rows store **delta** — see [interior-scene-nodes.md](interior-scene-nodes.md) |
| `rotation` | `[x,y,z]` | yes | Euler XYZ **radians** |
| `scale` | `[x,y,z]` | yes | Local scale; mirror rows store **delta** |
| `visible` | boolean | — | Editor preview visibility |
| `layerId` | string | — | Editor layering (optional) |
| `assetRef` | string | yes | **Placement** row: catalog `assetId` of a `.glb` |
| `sourceAssetRef` | string | — | **Mirror** row: catalogue asset id (see interior doc) |
| `sourceGltfNodeIndex` | integer | — | **Mirror** row: index in catalogue `.glb` `nodes[]` |
| `sourcePlacementId` | string | — | **Mirror** row: explicit host placement id when reparented outside subtree |
| `interactionAttachments` | array | yes (proto) | Script components on this node |

### `interactionAttachments[]`

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Stable attachment id (Play uses as `attachmentId`) |
| `scriptAssetRef` | string | `assets[].assetId` of script catalog entry |
| `serializedProps` | object | Inspector overrides merged before `onLoaded` / handler |

**Legacy load path:** singular fields `interactionScriptAssetRef`, `interactionTargetNodeId`, `interactionTargetSerializedId`, `interactionSerializedProps` are normalized on load; new saves use **`interactionAttachments`** only.

Preview and export derive **`targetId`** from the **merged glTF node index** of the host row unless overridden in `serializedProps`.

## Validation rules (backend)

- Every non-null `scene.nodes[].assetRef` must exist in `assets[].assetId`.
- `assets[]` may list entries not yet referenced by the scene.
- Interior mirror rows must resolve a **mesh host** — see [interior-scene-nodes.md](interior-scene-nodes.md).
- Skinned catalogue sources fail **`build-play-glb`** until supported.

## Alignment with portable standard

Editor-only catalog metadata (`scriptRole`, `interactionKind`, `interactionAttachments` storage shape) informs [`proposal-interactive-gltf-javascript-scripts`](../../../interactive-gltf-specs/interactive-gltf-specs/proposals/proposal-interactive-gltf-javascript-scripts.md). Exported shapes are documented in [play-export.md](play-export.md).
