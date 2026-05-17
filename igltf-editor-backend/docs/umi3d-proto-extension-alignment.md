# EXT_IGLTF_UMI3D_PROTO — prototype vs UMI3D SDK / interactive-gltf specs

**Language:** English (engineering notes).

This document records deliberate gaps between the **functional prototype** emitted by `igltf-editor-backend` (`build_play_glb.py`) and:

- **UMI3D SDK 2.9** glTF-shaped DTOs (`GlTFNodeDto`, `AbstractGlTFExtensions.umi3d`, interaction entities in `UMI3DSceneNodeDto.otherEntities`, `EventDto`, `InteractableDto`, …).
- **interactive-gltf-specs** proposals (`proposal-umi3d-interaction-model.md`, `proposal-interactive-gltf-javascript-scripts.md`).

The goal of the prototype is **ASAP parity for authoring → Play click → script handler**, not wire-compatibility with UMI3D servers.

## What the prototype does today

- Extension id: **`EXT_IGLTF_UMI3D_PROTO`** (placeholder until Khronos / project naming is fixed).
- Placement: **`nodes[i].extensions[EXT_IGLTF_UMI3D_PROTO].umi3d`**, mirroring the SDK pattern of a **`umi3d`** payload inside a glTF extension object (see `AbstractGlTFExtensions<T>.umi3d` in the SDK).
- **`gltfNodeIndex`** duplicates the node index (explicit reference for loaders / debugging).
- **`attachments[]`** map editor **interaction script** attachments:
  - **`scriptHandlerId`**: exported class name (`ProjectAsset.scriptExports[0]`), i.e. registry key for `loadModuleScriptIntoRegistry`.
  - **`scriptAssetRef`** / **`scriptRelativePath`**: resolve script source via `GET /files/{projectId}/{relativePath}`.
  - **`serializedProps`**: inspector overrides (merged into the class instance before `onLoaded` / handler), same spirit as editor `InteractionScriptAttachment.serializedProps`.
  - **Prototype default:** if **`targetId`** is absent, the exporter sets it to the **placement outer glTF node index** (string digits) so `GLTF.getObjectByUmi3dId` resolves without manual authoring.
  - **`dto`**: minimal stub with **`interactionType`** (mirrors `interactionKind`) and optional **`hold`** (UMI3D `EventDto.hold`); animations / `icon2D` / `uiLinkId` / ulong **entity ids** are **not** modeled.

## Major divergences to align later

| Area | Prototype | UMI3D SDK / target specs |
|------|-----------|-------------------------|
| Identity | glTF **node index** + optional author **`targetId`** in `serializedProps` | ulong **`AbstractEntityDto.id`**, separate interactable / tool lists, **`InteractableDto.nodeId`** |
| Where interactions live | Directly on **`glTF`** `nodes[]` extension | Often **`otherEntities`** + tools referencing **`interactions: List<ulong>`**; not the same container |
| Event semantics | Single **pointer down** path in Play | `EventDto` + **`EventTriggeredDto`** / **`EventStateChangedDto`**, hold edge semantics |
| Networking | None | **`InteractionRequestDto`** family, browser ↔ environment |
| Tools / interactables | Implicit (“node has attachments”) | Explicit **`AbstractToolDto`**, **`InteractableDto`** with hover/distance flags |
| Scripts | ES module text loaded at runtime from **`scriptRelativePath`** | Not defined as glTF-first-class in SDK 2.9; proposals still open on **`scripts[]`**, URIs, caps |
| Extension naming | `EXT_IGLTF_UMI3D_PROTO` | Must converge with **`specifications/`** + Khronos registration rules |

## Follow-up work

1. Freeze extension **prefix / JSON Schema** in **interactive-gltf-specs** (`specifications/`) and rename `EXT_IGLTF_UMI3D_PROTO`.
2. Decide **`extensionsRequired`** policy once a normative baseline exists.
3. Map **`dto`** payloads toward real **`EventDto`** (and other interaction types) or an interactive-gltf profile DTO.
4. Optionally introduce stable **`entityId`** strings independent of node indices for merged scenes.
5. Promote transaction vocabulary (`IgltfTransaction`) alongside UMI3D EDK operations where proposals require it.
