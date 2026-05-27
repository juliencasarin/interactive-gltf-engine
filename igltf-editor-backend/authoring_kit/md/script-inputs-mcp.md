# Script inputs — MCP agent guide

**Status:** Implemented.

**Canonical doc:** [`../../docs/editor/script-inputs-mcp.md`](../../docs/editor/script-inputs-mcp.md) — edit there first, then sync this file.

**Author-facing:** [`../../docs/editor/script-inputs.md`](../../docs/editor/script-inputs.md).

## Required workflow

1. `igltf_get_editor_session_status` → mutations
2. `igltf_introspect_script_inputs(script_asset_id)` → schema
3. `igltf_get_script_attachment_inputs(node_id, attachment_id)` → schema + current values
4. `igltf_set_script_inputs(...)` → validated write

**Do not** hand-patch `@igltfInput` fields via `igltf_update_script_on_node` / raw `serializedProps`.

## Runtime event options

`hold` is an event interaction option, not an `@igltfInput` field. It controls how Play routes input to `EventInteraction.onEvent(payload)`:

| `serializedProps.hold` | Runtime payloads |
|------------------------|------------------|
| absent / `false` | one call with `eventType: "trigger"` |
| `true` | press: `eventType: "holdStart", active: true`; release: `eventType: "holdEnd", active: false` |

Agents may set this unannotated runtime option with `serialized_props` when calling `igltf_add_script_to_node`, or with `igltf_update_script_on_node` for an existing attachment. Do not use this raw path for keys declared with `@igltfInput`; use `igltf_set_script_inputs` for those.

## Semantic values

| Kind | `value` |
|------|---------|
| node | `{ "nodeId": "<node.id from hierarchy>" }` |
| script | `{ "scriptAssetId": "…" }` — catalog **file**, not an instance |
| scriptAttachment | `{ "nodeId": "…", "attachmentId": "…" }` from node `interactionAttachments` |
| gltfAsset | `{ "gltfAssetId": "…" }` |
| object | Nested JSON per `inputDef.fields` |
| scalar | string / number / boolean / null |

`targetId`: do not set via MCP (runtime injects from host node).

## Example

```json
{
  "node_id": "n-host",
  "attachment_id": "att-1",
  "inputs": [{ "field": "doorTarget", "value": { "nodeId": "n-door" } }]
}
```

See the canonical doc for error codes and full examples.
