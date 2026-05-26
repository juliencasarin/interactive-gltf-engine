/**
 * @typedef {import('./interaction-registry.js').InteractionRecord} InteractionRecord
 */

/**
 * @typedef {Object} ToolRecord
 * @property {string} id
 * @property {number} gltfNodeIndex
 * @property {InteractionRecord[]} interactions
 * @property {string|null} selectorId
 * @property {boolean} isHovered
 */

export class ToolRegistry {
  constructor() {
    /** @type {Map<string, ToolRecord>} */
    this._tools = new Map()
  }

  /**
   * @param {string} id
   * @param {number} gltfNodeIndex
   * @param {InteractionRecord[]} interactions
   */
  register(id, gltfNodeIndex, interactions) {
    const existing = this._tools.get(id)
    if (existing) {
      existing.interactions = interactions
      return existing
    }
    const tool = {
      id,
      gltfNodeIndex,
      interactions,
      selectorId: null,
      isHovered: false,
    }
    this._tools.set(id, tool)
    return tool
  }

  /** @param {string} id */
  get(id) {
    return this._tools.get(id)
  }

  /** @returns {ToolRecord[]} */
  all() {
    return [...this._tools.values()]
  }

  clear() {
    this._tools.clear()
  }
}
