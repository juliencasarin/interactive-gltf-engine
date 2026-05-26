# Interaction migration inventory (UMI3D-BROWSER → igltf-engine)

Reference-only list of UMI3D Browser / SDK sources and their JS counterparts in this repo.

## CDK core (new model)

| UMI3D-SDK (CDK) | igltf-engine JS |
|-----------------|-----------------|
| `InteractionManager.cs` | `interaction-registry.js` |
| `ToolManager.cs` / `Tool.cs` | `tool-registry.js` |
| `Selector.cs` / `SelectorManager.cs` | `selector.js`, `selector-manager.js` |
| `Projection.cs` / `ProjectionManager.cs` | `projection.js`, `projection-manager.js` |
| `IInputSystem` / `Input.cs` | `pc-input-layer.js` (`BoundInput`) |

## Browser runtime

| UMI3D-BROWSER | igltf-engine JS |
|---------------|-----------------|
| `BrowserControllerManager.cs` | `pc-input-layer.js` (`associateInteractionAndInput`) |
| `BrowserInteractableManager.cs` | `ui/interactable-ui.js` |
| `UIDevice.cs` | UI placeholder inputs in `pc-input-layer.js` |
| `InteractableUIVC` | `InteractableUi` |

## Legacy (Form / Link / Manipulation rules)

| UMI3D-SDK | Ported via |
|-----------|------------|
| `InteractionMapper.cs` | Selector + projection dispatch |
| `ProjectionMemory.cs` | Per-kind `projectionSetup` in `selector.js` |
| PC `Inputs/Parameters/*` | `ui/contextual-menu-ui.js` |
| PC `ManipulationForDesktop.cs` | `onManipulation` + host transactions |

## VR / WebXR

| UMI3D-BROWSER VR base | igltf-engine JS |
|-----------------------|-----------------|
| `VRInteractionMapper.cs` | `webxr-input-layer.js` (API stub) |
| `InteractableVRSelector.cs` | `WebXrInputLayer.selectTool` |

## Author scripts

| Source | Target |
|--------|--------|
| `authoring_kit/js/interaction-bases.js` | `igltf-engine/js/interaction-bases.js` (+ `ParameterInteraction`) |
| `public/igltf-core/interaction-bases.js` | Keep in sync with `igltf-engine/js` for dev server |

## Functional cases checklist

- [x] Tool project / release
- [x] Hover enter / exit (pointer move)
- [x] Event click + hold (keyboard/mouse bindings)
- [x] Link open + `onLink`
- [x] Form UI + `onForm` / formAnswer payload
- [x] Manipulation dispatch (`onManipulation`)
- [x] Parameter contextual UI + `onParameter`
- [ ] Upload file (architecture only; Phase 1.5)
- [ ] WebXR pose-driven hover/select (stub)
- [x] Drawing excluded (`unsupported`)
