# Script inputs — MCP agent guide

**Status:** Implemented.

**Author-facing product doc:** [script-inputs.md](script-inputs.md)  
**Portable standard:** [`proposal-interactive-gltf-javascript-scripts`](../../../interactive-gltf-specs/interactive-gltf-specs/proposals/proposal-interactive-gltf-javascript-scripts.md) (`@igltfInput`, `IgltfInputRef`, `afterLoading`).

This document is the **operational workflow for LLM agents** using MCP scene tools. Do not guess raw `serializedProps` JSON for annotated fields.

## Required workflow

1. **`igltf_get_editor_session_status(project_id)`** — confirm `canMutateScene` before writes.
2. **`igltf_introspect_script_inputs(project_id, script_asset_id)`** — field schema from `@igltfInput` JSDoc.
3. **`igltf_get_script_attachment_inputs(project_id, node_id, attachment_id)`** — schema + current values + display labels.
4. **`igltf_set_script_inputs(project_id, node_id, attachment_id, inputs)`** — validated semantic write.

**Forbidden:** patching annotated keys through **`igltf_update_script_on_node`** with invented JSON shapes. That tool may return a **`warning`** when annotated keys are passed without validation.

## Tools

| Tool | Mutates | Purpose |
|------|---------|---------|
| `igltf_introspect_script_inputs` | No | Parse `@igltfInput` on a catalog script asset |
| `igltf_get_script_attachment_inputs` | No | Attachment schema + `serializedProps` + labels |
| `igltf_set_script_inputs` | Yes | Set fields with semantic `value` objects |

Script **source** edits remain disk / REST (`PUT …/assets/{id}/source`) — not MCP scene tools.

## Semantic `value` by kind

| `inputKind` | Semantic `value` (in `inputs[]`) | Stored JSON |
|-------------|----------------------------------|-------------|
| `node` | `{ "nodeId": "<authoring-node-id>" }` | `{ "kind": "node", "id": "…" }` |
| `script` | `{ "scriptAssetId": "…", "exportName?": "…" }` | `{ "kind": "script", "assetId": "…", "exportName?": "…" }` |
| `scriptAttachment` | `{ "nodeId": "…", "attachmentId": "…" }` | `{ "kind": "scriptAttachment", "nodeId": "…", "attachmentId": "…" }` |
| `gltfAsset` | `{ "gltfAssetId": "…" }` | `{ "kind": "gltfAsset", "assetId": "…" }` |
| `object` | Nested JSON matching `inputDef.fields` | Plain object (refs nested inside) |
| `scalar` | `string` \| `number` \| `boolean` \| `null` | Same scalar |

### ID sources (live session)

| Kind | Resolve IDs from |
|------|------------------|
| `node` | `igltf_list_scene_hierarchy` / `igltf_get_node_details` → **`node.id`** (not display name) |
| `script` | `igltf_list_assets` where `assetKind === 'script'` → **`assetId`** (catalog **file**, not an instance) |
| `scriptAttachment` | `nodeId` from hierarchy + `attachmentId` from `igltf_get_node_details` → `interactionAttachments[].id` on that node |
| `gltfAsset` | `igltf_list_assets` glTF rows → **`assetId`** |
| `targetId` | **Do not set** — runtime injects from the host scene node |

## Example: set a script attachment reference (Buggy → wheel RotateWheel)

**Request** (`igltf_set_script_inputs`):

```json
{
  "project_id": "…",
  "node_id": "n-buggy",
  "attachment_id": "att-click",
  "inputs": [
    {
      "field": "wheelFL",
      "value": { "nodeId": "n-wheel-fl", "attachmentId": "att-rotate-fl" }
    }
  ]
}
```

**Success result**:

```json
{
  "serializedProps": {
    "wheelFL": {
      "kind": "scriptAttachment",
      "nodeId": "n-wheel-fl",
      "attachmentId": "att-rotate-fl"
    }
  }
}
```

At Play runtime the handler resolves the live instance with `GLTF.getScriptByAttachmentId("att-rotate-fl")`.

## Example: set a node reference

**Request** (`igltf_set_script_inputs`):

```json
{
  "project_id": "…",
  "node_id": "n-host",
  "attachment_id": "att-1",
  "inputs": [
    { "field": "doorTarget", "value": { "nodeId": "n-door" } }
  ]
}
```

**Success result** (editor session):

```json
{
  "serializedProps": {
    "doorTarget": { "kind": "node", "id": "n-door" }
  }
}
```

## Example: introspect before write

```json
{
  "scriptAssetId": "script-door",
  "exportName": "DoorOpener",
  "fields": [
    {
      "field": "doorTarget",
      "inputKind": "node",
      "inputDef": { "kind": "node" }
    }
  ]
}
```

## Typical failures

| Code | Cause |
|------|-------|
| `no_live_session` | igltf-editor not open on project |
| `mcp_scene_edition_disabled` | Settings → Allow scene edition off |
| `attachment_not_found` | Wrong `attachment_id` for `node_id` |
| `unknown_field` | Field not on exported class / not in introspection |
| `invalid_input_value` | Semantic shape wrong (e.g. missing `nodeId`) |
| `validation_failed` | Node or asset id not in live catalog |
| `script_source_unavailable` | Script file missing and no inline `sourceText` |

## Related

- [mcp-scene-authoring.md](mcp-scene-authoring.md) — session gates and scene graph tools
- [script-authoring.md](script-authoring.md) — module patterns and lifecycle
