/**
 * World-space / screen overlay listing interactable name and projected inputs.
 */

export class InteractableUi {
  /**
   * @param {HTMLElement} [mount]
   */
  constructor(mount = document.body) {
    this._root = document.createElement('div')
    this._root.className = 'igltf-interactable-ui'
    this._root.style.cssText =
      'position:fixed;bottom:12px;left:12px;max-width:280px;padding:8px 12px;background:rgba(0,0,0,0.75);color:#fff;font:12px/1.4 system-ui,sans-serif;border-radius:8px;pointer-events:none;z-index:9000;display:none;'
    this._title = document.createElement('div')
    this._title.style.fontWeight = '600'
    this._inputs = document.createElement('ul')
    this._inputs.style.margin = '6px 0 0'
    this._inputs.style.paddingLeft = '18px'
    this._root.appendChild(this._title)
    this._root.appendChild(this._inputs)
    mount.appendChild(this._root)
    this.visible = false
  }

  /**
   * @param {import('../tool-registry.js').ToolRecord|null} tool
   * @param {import('../projection-manager.js').ProjectionManager} projectionManager
   */
  update(tool, projectionManager) {
    if (!tool) {
      this.hide()
      return
    }
    this._title.textContent = `Interactable (node ${tool.gltfNodeIndex})`
    this._inputs.replaceChildren()
    const projections = projectionManager.projections.filter((p) => p.tool === tool)
    for (const p of projections) {
      const li = document.createElement('li')
      li.textContent = `${p.interaction.kind}: ${p.interaction.dto?.name ?? p.interaction.id} ← ${p.input?.id ?? '—'}`
      this._inputs.appendChild(li)
    }
    this.show()
  }

  show() {
    this._root.style.display = 'block'
    this.visible = true
  }

  hide() {
    this._root.style.display = 'none'
    this.visible = false
  }

  destroy() {
    this._root.remove()
  }
}
