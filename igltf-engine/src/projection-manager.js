import { createProjection } from './projection.js'

/**
 * @typedef {import('./projection.js').Projection} Projection
 * @typedef {import('./projection.js').ProjectionDeps} ProjectionDeps
 */

export class ProjectionManager {
  constructor() {
    /** @type {Projection[]} */
    this._projections = []
    /** @type {ProjectionDeps|null} */
    this.deps = null
  }

  /** @param {ProjectionDeps} deps */
  setDeps(deps) {
    this.deps = deps
  }

  /**
   * @param {import('./selector.js').Selector} selector
   * @param {import('./tool-registry.js').ToolRecord} tool
   * @param {import('./interaction-registry.js').InteractionRecord} interaction
   * @param {import('./pc-input-layer.js').BoundInput|null} input
   * @returns {Projection}
   */
  project(selector, tool, interaction, input) {
    if (!this.deps) throw new Error('[ProjectionManager] deps not set')
    let projection = this._projections.find(
      (p) =>
        p.selector === selector &&
        p.tool === tool &&
        p.interaction === interaction &&
        p.input === input,
    )
    if (!projection) {
      projection = createProjection(selector, tool, interaction, input, this.deps)
      this._projections.push(projection)
    }
    if (interaction.projectionSetup) {
      interaction.projectionSetup(projection)
    }
    return projection
  }

  /** @param {Projection} projection */
  release(projection) {
    const idx = this._projections.indexOf(projection)
    if (idx < 0) return false
    projection.clear()
    this._projections.splice(idx, 1)
    return true
  }

  /** @param {import('./tool-registry.js').ToolRecord} tool */
  releaseAllForTool(tool) {
    const toRelease = this._projections.filter((p) => p.tool === tool)
    for (const p of toRelease) this.release(p)
  }

  /** @returns {Projection[]} */
  get projections() {
    return [...this._projections]
  }

  clear() {
    for (const p of [...this._projections]) {
      p.clear()
    }
    this._projections = []
  }
}
