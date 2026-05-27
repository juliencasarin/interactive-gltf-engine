# Play export — merged glTF and script bundle

**Status:** Implemented (`POST /projects/{id}/build-play-glb`, Play viewer).

## Outputs

| Artifact | Path | Purpose |
|----------|------|---------|
| Merged scene | `build/scene.glb` | Single glTF with catalogue geometry + interior mirrors + interaction extensions |
| Script bundle | `build/scene.js` | esbuild bundle of all catalog script assets (when scripts exist) |
| Play manifest | `GET /play/{id}` | `{ glbUrl, jsUrl? }` absolute URLs |

Legacy fallbacks: root `test.glb`, `build/play.js`, root `test.js`.

## Root extension — `EXT_interactive_gltf`

When scripts exist, glTF declares:

- **`extensionsUsed`**: includes `EXT_interactive_gltf`
- Root extension **`scripts[]`**: single bundled entry pointing at **`scene.js`** (`kind: classic`)
- **`extensionsRequired`**: not used in current milestone

Bundle order follows DAG edges in **`scriptDependsOnAssetIds`**. Imports under **`/igltf-core/*`** are **external** at bundle time (viewer supplies modules).

**esbuild** runs under `igltf-editor-backend/` (`npm install` once) or via **`ESBUILD_BINARY`**.

## Per-node extension — `EXT_IGLTF_UMI3D_PROTO` (prototype)

**Placeholder name** until Khronos / project naming freezes in **`interactive-gltf-specs`**.

Placement: **`nodes[i].extensions.EXT_IGLTF_UMI3D_PROTO.umi3d`**

| Field | Meaning |
|-------|---------|
| `gltfNodeIndex` | Duplicate of node index (debug / loader convenience) |
| `attachments[]` | Interaction script bindings from editor `interactionAttachments` |
| `attachments[].scriptHandlerId` | Export class name (`scriptExports[0]`) |
| `attachments[].scriptAssetRef` / `scriptRelativePath` | Resolve source via `/files/{projectId}/…` |
| `attachments[].serializedProps` | Inspector overrides |
| `attachments[].dto` | Stub: `interactionType`, optional `hold` |

**`targetId` semantics:** refers to a **glTF `nodes[]` index in the emitted `scene.glb`**, not the catalogue file. If absent in `serializedProps`, exporter sets it to the **merged glTF node index** (string digits) for the authoring row — including interior mirror rows.

For event interactions, attachment `serializedProps.hold === true` is exported as `attachments[].dto.hold === true`.
Play then emits `payload.eventType: "holdStart"` on pointer/key down and `"holdEnd"` on pointer/key up. Without hold, Play emits a one-shot `"trigger"` event.

## Divergences vs target specs (track in specs repo)

| Area | Prototype (this editor) | Target (`interactive-gltf-specs`) |
|------|-------------------------|-------------------------------------|
| Extension id | `EXT_IGLTF_UMI3D_PROTO` | TBD Khronos-aligned name in `specifications/` |
| Identity | glTF node index + optional `targetId` | UMI3D ulong entity ids, tools/interactables |
| Interaction container | Directly on `nodes[]` extension | Often `otherEntities` + tool lists |
| Event semantics | Single pointer-down path in Play | Full `EventDto` + request DTO family |
| Scripts in glTF | Sidecar `scene.js` + proto attachments | Normative `scripts[]` in [`proposal-interactive-gltf-javascript-scripts`](../../../interactive-gltf-specs/interactive-gltf-specs/proposals/proposal-interactive-gltf-javascript-scripts.md) |
| Networking | None | UMI3D session protocol (out of scope for Play POC) |

When closing gaps, update **`interactive-gltf-specs`** proposals first, then align exporter/Play.

## Play runtime behaviour

- Loads `scene.glb` + `scene.js`; registry keyed by export class name.
- **Behaviour scripts** (`scriptRole: behaviour`): one instance per attachment id; lifecycle `onLoaded` / `onUpdate` / `onDelete`.
- **Interaction scripts**: kind bases from `/igltf-core/interaction-bases.js`; handler on pointer path.
- **Host API**: global **`GLTF`** — see authoring kit [host-api.md](../../igltf-editor-backend/authoring_kit/md/host-api.md) (typings mirror `igltfHost.d.ts`).

## Interior + interactions

Interactions may attach to deep mirror rows when `sourceGltfNodeIndex` is set. Export maps each authoring row to a merged gl node — see [interior-scene-nodes.md](interior-scene-nodes.md).

## Validation failures

- Skinned catalogue sources → `HTTP 400` on build.
- Invalid mirror host resolution → build/preview error until authoring fixed.

## Follow-up (engineering)

1. Freeze extension prefix / JSON Schema in specs; rename proto extension.
2. Decide `extensionsRequired` policy.
3. Map `dto` toward real interaction DTOs or interactive-gltf profile.
4. Optional stable `entityId` strings independent of node indices.
5. Promote transaction vocabulary (`IgltfTransaction`) with UMI3D EDK alignment.
