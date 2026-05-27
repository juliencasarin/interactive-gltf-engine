/**
 * Contextual menu for parameter interactions (display / edit).
 */

export class ContextualMenuUi {
  /**
   * @param {HTMLElement} [mount]
   */
  constructor(mount = document.body) {
    this._root = document.createElement('div')
    this._root.className = 'igltf-contextual-menu'
    this._root.style.cssText =
      'position:fixed;top:12px;right:12px;width:260px;max-height:70vh;overflow:auto;background:#252525;color:#eee;padding:12px;border-radius:8px;font:12px system-ui,sans-serif;z-index:9050;display:none;box-shadow:0 4px 24px rgba(0,0,0,0.4);'
    this._title = document.createElement('div')
    this._title.style.fontWeight = '600'
    this._body = document.createElement('div')
    this._root.appendChild(this._title)
    this._root.appendChild(this._body)
    mount.appendChild(this._root)
  }

  /**
   * @param {import('../interaction-registry.js').InteractionRecord[]} parameters
   * @param {(interaction: import('../interaction-registry.js').InteractionRecord, value: unknown) => void} onChange
   */
  showParameters(parameters, onChange) {
    this._title.textContent = 'Parameters'
    this._body.replaceChildren()
    for (const param of parameters) {
      if (param.kind !== 'parameter') continue
      const row = document.createElement('div')
      row.style.marginBottom = '10px'
      const label = document.createElement('label')
      label.textContent = String(param.dto?.name ?? param.id)
      label.style.display = 'block'
      label.style.marginBottom = '4px'
      const control = this._controlFor(param, (value) => onChange(param, value))
      row.appendChild(label)
      row.appendChild(control)
      this._body.appendChild(row)
    }
    this._root.style.display = 'block'
  }

  /**
   * @param {import('../interaction-registry.js').InteractionRecord} param
   * @param {(value: unknown) => void} onChange
   */
  _controlFor(param, onChange) {
    const dto = param.dto ?? {}
    const pType = String(dto.parameterType ?? dto.type ?? 'boolean').toLowerCase()
    if (pType === 'boolean' || pType === 'bool') {
      const el = document.createElement('input')
      el.type = 'checkbox'
      el.checked = Boolean(dto.value)
      el.disabled = Boolean(dto.isDisplayer)
      el.addEventListener('change', () => onChange(el.checked))
      return el
    }
    if (pType === 'float' || pType === 'floatrange') {
      const el = document.createElement('input')
      el.type = 'range'
      el.min = String(dto.min ?? 0)
      el.max = String(dto.max ?? 100)
      el.step = String(dto.increment ?? 0.1)
      el.value = String(dto.value ?? 0)
      el.disabled = Boolean(dto.isDisplayer)
      el.addEventListener('input', () => onChange(Number(el.value)))
      return el
    }
    if (pType === 'enum' || pType === 'stringenum') {
      const el = document.createElement('select')
      const values = dto.possibleValues ?? []
      for (const v of values) {
        const opt = document.createElement('option')
        opt.value = String(v)
        opt.textContent = String(v)
        el.appendChild(opt)
      }
      el.value = String(dto.value ?? '')
      el.disabled = Boolean(dto.isDisplayer)
      el.addEventListener('change', () => onChange(el.value))
      return el
    }
    const el = document.createElement('input')
    el.type = 'text'
    el.value = String(dto.value ?? '')
    el.disabled = Boolean(dto.isDisplayer)
    el.addEventListener('change', () => onChange(el.value))
    return el
  }

  hide() {
    this._root.style.display = 'none'
  }

  destroy() {
    this._root.remove()
  }
}
