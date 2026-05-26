import {
  associateInteractionAndInput,
  createPcEventInputs,
  createUiPlaceholderInput,
  isEventInteraction,
  isHoldEvent,
} from './pc-input-layer.js'

/** PC mouse/keyboard selector id (UMI3D Browser: `Mouse`). */
export const PC_SELECTOR_ID = 'Mouse'

/**
 * @typedef {Object} SelectorDataDelegate
 * @property {number} toolCountLimitation
 * @property {(tool: import('./tool-registry.js').ToolRecord) => Map<import('./interaction-registry.js').InteractionRecord, import('./pc-input-layer.js').BoundInput[]>} getInputsByInteraction
 * @property {(associations: Array<{interaction: import('./interaction-registry.js').InteractionRecord, input: import('./pc-input-layer.js').BoundInput}>, tool: import('./tool-registry.js').ToolRecord, reserveLeftMouseForUi: boolean) => Array<{interaction: import('./interaction-registry.js').InteractionRecord, input: import('./pc-input-layer.js').BoundInput}>} associateInteractionAndInput
 * @property {(projection: import('./projection.js').Projection) => void} setupProjection
 */

/**
 * @param {import('./projection-manager.js').ProjectionManager} projectionManager
 * @returns {SelectorDataDelegate}
 */
export function createDefaultPcSelectorDelegate(projectionManager) {
  return {
    toolCountLimitation: 1,
    getInputsByInteraction(tool) {
      const map = new Map()
      for (const interaction of tool.interactions) {
        if (interaction.kind === 'unsupported') continue
        if (isEventInteraction(interaction)) {
          map.set(interaction, createPcEventInputs())
        } else {
          map.set(interaction, [createUiPlaceholderInput(`ui:${interaction.id}`)])
        }
      }
      return map
    },
    associateInteractionAndInput(_associations, tool, reserveLeftMouseForUi) {
      const events = tool.interactions.filter(isEventInteraction)
      // Parameters use the contextual menu, not PC pointer bindings.
      const others = tool.interactions.filter(
        (i) =>
          !isEventInteraction(i) &&
          i.kind !== 'unsupported' &&
          i.kind !== 'parameter',
      )
      const inputsByInteraction = this.getInputsByInteraction(tool)
      return associateInteractionAndInput(events, others, inputsByInteraction, reserveLeftMouseForUi)
    },
    setupProjection(projection) {
      const { interaction } = projection
      const input = projection.input
      if (!input) return

      switch (interaction.kind) {
        case 'event': {
          const hold = isHoldEvent(interaction)
          input.onStarted(() => {
            if (hold) void projection.sendEventStateChanged(true)
            else void projection.sendEventTriggered()
          })
          input.onCanceled(() => {
            if (hold) void projection.sendEventStateChanged(false)
          })
          break
        }
        case 'link':
          input.onPerformed(() => {
            const url = String(interaction.dto?.url ?? interaction.serializedProps?.href ?? '')
            void projection.sendLinkOpened(url)
          })
          break
        case 'form':
          input.onPerformed(() => {
            void projection.sendFormAnswer({})
          })
          break
        case 'manipulation':
          input.onPerformed(() => {
            void projection.sendManipulation(
              { x: 0, y: 0, z: 0 },
              { x: 0, y: 0, z: 0, w: 1 },
            )
          })
          break
        case 'parameter':
          input.onPerformed((value) => {
            if (interaction.dto?.isDisplayer) return
            if (value !== undefined) interaction.dto.value = value
            void projection.sendParameterSetting()
          })
          break
        default:
          break
      }
    },
  }
}

export class Selector {
  /**
   * @param {string} id
   * @param {SelectorDataDelegate} dataDelegate
   * @param {import('./projection-manager.js').ProjectionManager} projectionManager
   */
  constructor(id, dataDelegate, projectionManager) {
    this.id = id
    this.dataDelegate = dataDelegate
    this.projectionManager = projectionManager
    /** @type {import('./tool-registry.js').ToolRecord[]} */
    this._projectedTools = []
    this.hoveredObjectId = null
    this._bone = {
      boneType: 0,
      bonePosition: { x: 0, y: 0, z: 0 },
      boneRotation: { x: 0, y: 0, z: 0, w: 1 },
    }
    /** @type {((kind: string, tool: import('./tool-registry.js').ToolRecord, extra: Record<string, unknown>) => void)|null} */
    this.onLifecycleRequest = null
  }

  get canProjectMoreTool() {
    return this._projectedTools.length < this.dataDelegate.toolCountLimitation
  }

  getBoneContext() {
    return { ...this._bone }
  }

  /**
   * @param {{x:number,y:number,z:number}} position
   * @param {{x:number,y:number,z:number,w:number}} [rotation]
   */
  setBoneFromCamera(position, rotation) {
    this._bone.bonePosition = { ...position }
    if (rotation) this._bone.boneRotation = { ...rotation }
  }

  /**
   * @param {import('./tool-registry.js').ToolRecord} tool
   * @param {boolean} [reserveLeftMouseForUi]
   */
  select(tool, reserveLeftMouseForUi = false) {
    if (!this.canProjectMoreTool) return

    const associations = this.dataDelegate.associateInteractionAndInput([], tool, reserveLeftMouseForUi)

    for (const { interaction, input } of associations) {
      if (interaction.kind === 'unsupported') continue
      const priorSetup = interaction.projectionSetup
      interaction.projectionSetup = (projection) => {
        priorSetup?.(projection)
        this.dataDelegate.setupProjection(projection)
      }
      this.projectionManager.project(this, tool, interaction, input)
    }

    this._projectedTools.push(tool)
    tool.selectorId = this.id
    this.onLifecycleRequest?.('toolProjected', tool, { selectorId: this.id })
  }

  /**
   * @param {import('./tool-registry.js').ToolRecord} tool
   */
  deselect(tool) {
    const idx = this._projectedTools.indexOf(tool)
    if (idx >= 0) this._projectedTools.splice(idx, 1)
    tool.selectorId = null
    this.projectionManager.releaseAllForTool(tool)
    this.onLifecycleRequest?.('toolReleased', tool, { selectorId: this.id })
  }

  /**
   * @param {import('./tool-registry.js').ToolRecord} tool
   * @param {string} hoveredId
   * @param {boolean} enter
   */
  hoverStateChanged(tool, hoveredId, enter) {
    this.hoveredObjectId = enter ? hoveredId : null
    tool.isHovered = enter
    this.onLifecycleRequest?.('hoverStateChanged', tool, {
      state: enter,
      hoveredObjectId: hoveredId,
    })
  }

  /**
   * @param {import('./tool-registry.js').ToolRecord} tool
   * @param {string} hoveredId
   */
  hovered(tool, hoveredId) {
    this.hoveredObjectId = hoveredId
    this.onLifecycleRequest?.('hovered', tool, { hoveredObjectId: hoveredId })
  }

  dispose() {
    for (const tool of [...this._projectedTools]) {
      this.deselect(tool)
    }
  }
}
