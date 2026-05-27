import { buildRegistriesFromGltfNodes } from './runtime-dispatch.js'
import { ProjectionManager } from './projection-manager.js'
import {
  createPcInputLayerState,
  handleKeyboardEvent,
  handlePrimaryPointer,
} from './pc-input-layer.js'
import { SelectorManager } from './selector-manager.js'
import { createDefaultPcSelectorDelegate, PC_SELECTOR_ID, Selector } from './selector.js'
import { ContextualMenuUi } from './ui/contextual-menu-ui.js'
import { FormsUi } from './ui/forms-ui.js'
import { InteractableUi } from './ui/interactable-ui.js'
import { canStartImmersiveSession, WebXrInputLayer } from './webxr-input-layer.js'

export { PC_SELECTOR_ID }

/**
 * @typedef {Object} PlayInteractionRuntimeOptions
 * @property {Array<{ extensions?: Record<string, unknown> }>} gltfNodes
 * @property {string} [protoExtensionKey]
 * @property {(attachmentId: string, handlerId: string, payload: Record<string, unknown>, method: string) => Promise<unknown>} invokeInteraction
 * @property {(tool: import('./tool-registry.js').ToolRecord) => string} [resolveHoveredId]
 * @property {HTMLElement} [uiMount]
 * @property {(url: string) => void} [openLink]
 */

export class PlayInteractionRuntime {
  /**
   * @param {PlayInteractionRuntimeOptions} options
   */
  constructor(options) {
    this.invokeInteraction = options.invokeInteraction
    this.resolveHoveredId = options.resolveHoveredId ?? ((tool) => tool.id)
    this.openLink =
      options.openLink ??
      ((url) => {
        if (url) window.open(url, '_blank', 'noopener,noreferrer')
      })

    const { toolRegistry, interactionRegistry } = buildRegistriesFromGltfNodes(
      options.gltfNodes,
      options.protoExtensionKey,
    )
    this.toolRegistry = toolRegistry
    this.interactionRegistry = interactionRegistry

    this.projectionManager = new ProjectionManager()
    this.projectionManager.setDeps({
      invoke: (attachmentId, handlerId, payload, method) =>
        this.invokeInteraction(attachmentId, handlerId, payload, method),
    })

    this.selectorManager = new SelectorManager()
    const pcDelegate = createDefaultPcSelectorDelegate(this.projectionManager)
    /** @type {Selector} */
    this.pcSelector = this.selectorManager.instantiateOrGet(
      PC_SELECTOR_ID,
      pcDelegate,
      this.projectionManager,
    )

    this.pcInputState = createPcInputLayerState()
    /** @type {import('./tool-registry.js').ToolRecord|null} */
    this.hoveredTool = null
    /** @type {import('./tool-registry.js').ToolRecord|null} */
    this.selectedTool = null

    const mount = options.uiMount ?? (typeof document !== 'undefined' ? document.body : null)
    this.interactableUi = mount ? new InteractableUi(mount) : null
    this.formsUi = mount ? new FormsUi(mount) : null
    this.contextualMenuUi = mount ? new ContextualMenuUi(mount) : null

    this.webxr = new WebXrInputLayer({
      selectorManager: this.selectorManager,
      projectionManager: this.projectionManager,
      onSelectTool: (tool, hand) => {
        this.selectedTool = tool
        this.interactableUi?.update(tool, this.projectionManager)
      },
    })

    this._wireSelectorLifecycle()
    this._attachUiProjectionHooks()
  }

  _wireSelectorLifecycle() {
    const bind = (/** @type {Selector} */ selector) => {
      selector.onLifecycleRequest = (kind, tool, extra) => {
        if (kind === 'hoverStateChanged' && extra.state) {
          this.hoveredTool = tool
        } else if (kind === 'hoverStateChanged' && !extra.state) {
          if (this.hoveredTool === tool) this.hoveredTool = null
        }
        if (kind === 'toolProjected') {
          this.selectedTool = tool
          this.interactableUi?.update(tool, this.projectionManager)
          this._syncPcInputBindings()
        }
        if (kind === 'toolReleased' && this.selectedTool === tool) {
          this.selectedTool = null
          this.interactableUi?.hide()
          this.pcInputState.activeBindings = []
        }
      }
    }
    bind(this.pcSelector)
  }

  _attachUiProjectionHooks() {
    for (const tool of this.toolRegistry.all()) {
      for (const interaction of tool.interactions) {
        const prior = interaction.projectionSetup
        interaction.projectionSetup = (projection) => {
          prior?.(projection)
          if (interaction.kind === 'form') {
            projection.input?.onPerformed?.(() => {
              this.formsUi?.open(interaction, (answers) => {
                void projection.sendFormAnswer(answers)
              })
            })
          }
        }
      }
    }
  }

  _syncPcInputBindings() {
    this.pcInputState.activeBindings = this.projectionManager.projections
      .filter((p) => p.selector === this.pcSelector)
      .map((p) => ({ interaction: p.interaction, input: p.input }))
  }

  /**
   * @param {{x:number,y:number,z:number}} cameraPosition
   * @param {{x:number,y:number,z:number,w:number}} [cameraRotation]
   */
  setBoneFromCamera(cameraPosition, cameraRotation) {
    this.pcSelector.setBoneFromCamera(cameraPosition, cameraRotation)
  }

  /**
   * @param {import('./tool-registry.js').ToolRecord} tool
   */
  projectTool(tool) {
    // Reserve left mouse only when a form/manipulation menu would use it (not for parameters alone).
    const reserveLeftMouseForUi = tool.interactions.some(
      (i) => i.kind === 'form' || i.kind === 'manipulation',
    )
    const alreadyProjected = this.selectedTool === tool
    if (!alreadyProjected) {
      this.pcSelector.select(tool, reserveLeftMouseForUi)
    }
    this._syncPcInputBindings()
    const params = tool.interactions.filter((i) => i.kind === 'parameter')
    if (params.length && this.contextualMenuUi) {
      this.contextualMenuUi.showParameters(params, (interaction, value) => {
        if (!interaction.dto.isDisplayer) {
          interaction.dto.value = value
        }
        const proj = this.projectionManager.projections.find(
          (p) => p.interaction === interaction,
        )
        if (proj) void proj.sendParameterSetting()
      })
    }
  }

  releaseTool(tool) {
    this.pcSelector.deselect(tool)
    this.contextualMenuUi?.hide()
  }

  /**
   * @param {import('./tool-registry.js').ToolRecord|null} tool
   * @param {boolean} enter
   */
  setHover(tool, enter) {
    if (!tool) return
    const hoveredId = this.resolveHoveredId(tool)
    this.pcSelector.hoverStateChanged(tool, hoveredId, enter)
    if (enter) {
      this.interactableUi?.update(tool, this.projectionManager)
    } else if (!this.selectedTool) {
      this.interactableUi?.hide()
    }
  }

  /**
   * Pointer down on canvas — project tool under cursor, then trigger primary-bound events.
   * @param {import('./tool-registry.js').ToolRecord} tool
   */
  handlePointerDownOnTool(tool) {
    if (this.selectedTool && this.selectedTool !== tool) {
      this.releaseTool(this.selectedTool)
    }
    this.projectTool(tool)
    this._syncPcInputBindings()
    this.handlePrimaryPointer('down')
  }

  /** Pointer up on canvas — end hold events bound to primary click. */
  handlePointerUpOnTool() {
    this.handlePrimaryPointer('up')
  }

  /**
   * @param {KeyboardEvent} e
   * @param {'down'|'up'} phase
   */
  handleKeyboard(e, phase) {
    handleKeyboardEvent(this.pcInputState, e, phase)
  }

  /**
   * @param {'down'|'up'} phase
   */
  handlePrimaryPointer(phase) {
    handlePrimaryPointer(this.pcInputState, phase)
  }

  /** @param {XRFrame} frame */
  tickWebXr(frame) {
    this.webxr.tick(frame)
  }

  async tryEnterWebXr() {
    if (!(await canStartImmersiveSession()) || !navigator.xr?.requestSession) return false
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    })
    await this.webxr.attachSession(session)
    return true
  }

  destroy() {
    this.selectorManager.clear()
    this.projectionManager.clear()
    this.interactableUi?.destroy()
    this.formsUi?.destroy()
    this.contextualMenuUi?.destroy()
    this.webxr.detachSession()
  }
}

/**
 * @param {PlayInteractionRuntimeOptions} options
 * @returns {PlayInteractionRuntime}
 */
export function createPlayInteractionRuntime(options) {
  return new PlayInteractionRuntime(options)
}
