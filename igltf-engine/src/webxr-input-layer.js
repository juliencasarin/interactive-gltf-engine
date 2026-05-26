import { createDefaultPcSelectorDelegate, Selector } from './selector.js'

/**
 * WebXR input layer: left/right selectors mirroring VR browser split.
 * Camera/navigation unchanged — only interaction rays/controllers.
 */

export const WEBXR_SELECTOR_LEFT = 'LeftVR'
export const WEBXR_SELECTOR_RIGHT = 'RightVR'

/**
 * @typedef {Object} WebXrInputLayerOptions
 * @property {import('./selector-manager.js').SelectorManager} selectorManager
 * @property {import('./projection-manager.js').ProjectionManager} projectionManager
 * @property {(tool: import('./tool-registry.js').ToolRecord, hand: 'left'|'right') => void} [onSelectTool]
 */

export class WebXrInputLayer {
  /**
   * @param {WebXrInputLayerOptions} options
   */
  constructor(options) {
    this.selectorManager = options.selectorManager
    this.projectionManager = options.projectionManager
    this.onSelectTool = options.onSelectTool
    /** @type {XRSession|null} */
    this.session = null
    /** @type {Selector|null} */
    this.leftSelector = null
    /** @type {Selector|null} */
    this.rightSelector = null
    this.active = false
  }

  /**
   * @param {XRSession} session
   */
  async attachSession(session) {
    this.session = session
    this.active = true
    const delegate = createDefaultPcSelectorDelegate(this.projectionManager)
    delegate.toolCountLimitation = 1
    this.leftSelector = this.selectorManager.instantiateOrGet(
      WEBXR_SELECTOR_LEFT,
      delegate,
      this.projectionManager,
    )
    this.rightSelector = this.selectorManager.instantiateOrGet(
      WEBXR_SELECTOR_RIGHT,
      delegate,
      this.projectionManager,
    )
    session.addEventListener('end', () => this.detachSession())
  }

  detachSession() {
    this.session = null
    this.active = false
    this.leftSelector?.dispose()
    this.rightSelector?.dispose()
    this.leftSelector = null
    this.rightSelector = null
  }

  /**
   * @param {'left'|'right'} hand
   * @param {import('./tool-registry.js').ToolRecord} tool
   */
  selectTool(hand, tool) {
    const selector = hand === 'left' ? this.leftSelector : this.rightSelector
    if (!selector) return
    selector.select(tool, false)
    this.onSelectTool?.(tool, hand)
  }

  /**
   * @param {'left'|'right'} hand
   * @param {import('./tool-registry.js').ToolRecord} tool
   */
  releaseTool(hand, tool) {
    const selector = hand === 'left' ? this.leftSelector : this.rightSelector
    selector?.deselect(tool)
  }

  /**
   * Per-frame hook from Play (when WebXR session active).
   * @param {XRFrame} _frame
   */
  tick(_frame) {
    if (!this.active || !this.session) return
    // Future: read targetRaySpace poses, drive hover/select. Parity stub for Phase 1 API surface.
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function isWebXrAvailable() {
  return (
    typeof navigator !== 'undefined' &&
    'xr' in navigator &&
    typeof navigator.xr?.isSessionSupported === 'function'
  )
}

/**
 * @returns {Promise<boolean>}
 */
export async function canStartImmersiveSession() {
  if (!navigator.xr?.isSessionSupported) return false
  try {
    return await navigator.xr.isSessionSupported('immersive-vr')
  } catch {
    return false
  }
}
