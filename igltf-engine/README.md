# igltf-engine

JavaScript/Three.js **interaction runtime** for interactive-gltf Play and future viewers.

## Package layout

| Path | Role |
|------|------|
| `src/` | Runtime: tool/selector/projection, PC + WebXR input layers, Play orchestration |
| `js/interaction-bases.js` | Author-facing interaction script base classes |
| `js/gltf-script.js` | `GlTFScript` base class |

## Public API

```js
import { createPlayInteractionRuntime } from 'igltf-engine'
```

- **Contract:** `interaction-runtime-contract.js` — portable payloads (`eventTriggered`, `formAnswer`, `manipulationRequest`, …).
- **Play:** `PlayInteractionRuntime` wires registries, PC selector, DOM UIs (interactable list, forms, contextual parameters), optional WebXR layer.
- **Drawing:** explicitly unsupported at this stage (`normalizeInteractionKind('drawing')` → `unsupported`).

## Play integration

The editor frontend imports this package via Vite alias (`igltf-engine` → `../igltf-engine/src/index.js`). See `igltf-editor-frontend/src/play/playInteractionRuntimeBridge.ts` and `PlayInteractiveGltf.tsx`.

Camera/navigation remain in the Play React layer; this package only handles interaction selection, projection, and script invocation.

## Tests

```bash
cd igltf-engine && npm test
```

## Spec sync

When exported payloads or host callbacks stabilize, update **interactive-gltf-specs** (`proposals/` / `specifications/`) using the `sync-interactive-gltf-format-from-engine` skill. See `docs/interaction-runtime.md`.
