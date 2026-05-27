/**
 * @typedef {import('./interaction-runtime-contract.js').InteractionKind} InteractionKind
 */

/**
 * @typedef {Object} InteractionRecord
 * @property {string} id
 * @property {InteractionKind} kind
 * @property {Record<string, unknown>} dto
 * @property {string} scriptHandlerId
 * @property {string} attachmentId
 * @property {Record<string, unknown>} serializedProps
 * @property {(projection: import('./projection.js').Projection) => void} [projectionSetup]
 */

export class InteractionRegistry {
  constructor() {
    /** @type {Map<string, InteractionRecord>} */
    this._byId = new Map()
  }

  /**
   * @param {string} id
   * @param {Omit<InteractionRecord, 'projectionSetup'> & { projectionSetup?: InteractionRecord['projectionSetup'] }} record
   * @returns {InteractionRecord}
   */
  register(id, record) {
    const existing = this._byId.get(id)
    if (existing) return existing
    const r = { ...record, id }
    this._byId.set(id, r)
    return r
  }

  /** @param {string} id */
  get(id) {
    return this._byId.get(id)
  }

  /** @returns {InteractionRecord[]} */
  all() {
    return [...this._byId.values()]
  }

  clear() {
    this._byId.clear()
  }
}
