import { Selector } from './selector.js'

export class SelectorManager {
  constructor() {
    /** @type {Map<string, Selector>} */
    this._selectors = new Map()
    /** @type {Selector|null} */
    this.lastSelectorUsed = null
    /** @type {Selector|null} */
    this.lastSelectorSelected = null
    /** @type {Selector|null} */
    this.lastSelectorDeselected = null
    /** @type {Selector|null} */
    this.serverSelector = null
  }

  /**
   * @param {string} id
   * @param {import('./selector.js').SelectorDataDelegate} dataDelegate
   * @param {import('./projection-manager.js').ProjectionManager} projectionManager
   */
  instantiateOrGet(id, dataDelegate, projectionManager) {
    let selector = this._selectors.get(id)
    if (selector) return selector
    selector = new Selector(id, dataDelegate, projectionManager)
    this._selectors.set(id, selector)
    return selector
  }

  /** @param {string} id */
  get(id) {
    return this._selectors.get(id)
  }

  clear() {
    for (const s of this._selectors.values()) {
      s.dispose()
    }
    this._selectors.clear()
  }
}
