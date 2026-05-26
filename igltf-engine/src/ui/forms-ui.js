/**
 * Modal form UI (UMI3D FormDto fields subset).
 */

export class FormsUi {
  /**
   * @param {HTMLElement} [mount]
   */
  constructor(mount = document.body) {
    this._overlay = document.createElement('div')
    this._overlay.className = 'igltf-forms-ui'
    this._overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:none;align-items:center;justify-content:center;z-index:9100;'
    this._panel = document.createElement('div')
    this._panel.style.cssText =
      'background:#1e1e1e;color:#eee;padding:16px;border-radius:8px;min-width:320px;max-width:90vw;max-height:80vh;overflow:auto;font:13px system-ui,sans-serif;'
    this._form = document.createElement('form')
    this._panel.appendChild(this._form)
    this._overlay.appendChild(this._panel)
    mount.appendChild(this._overlay)
    /** @type {((answers: Record<string, unknown>) => void)|null} */
    this._onSubmit = null
    this._form.addEventListener('submit', (e) => {
      e.preventDefault()
      const answers = {}
      const data = new FormData(this._form)
      for (const [k, v] of data.entries()) {
        answers[k] = v
      }
      this._onSubmit?.(answers)
      this.hide()
    })
  }

  /**
   * @param {import('../interaction-registry.js').InteractionRecord} interaction
   * @param {(answers: Record<string, unknown>) => void} onSubmit
   */
  open(interaction, onSubmit) {
    this._onSubmit = onSubmit
    this._form.replaceChildren()
    const title = document.createElement('h3')
    title.textContent = String(interaction.dto?.name ?? 'Form')
    title.style.marginTop = '0'
    this._form.appendChild(title)

    const fields = interaction.dto?.fields ?? interaction.serializedProps?.fields
    if (Array.isArray(fields)) {
      for (const field of fields) {
        this._appendField(field)
      }
    } else {
      const fallback = document.createElement('p')
      fallback.textContent = 'No exported fields; submit to invoke onForm.'
      this._form.appendChild(fallback)
    }

    const actions = document.createElement('div')
    actions.style.marginTop = '12px'
    actions.style.display = 'flex'
    actions.style.gap = '8px'
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = 'Submit'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => this.hide())
    actions.appendChild(submit)
    actions.appendChild(cancel)
    this._form.appendChild(actions)

    this._overlay.style.display = 'flex'
  }

  /** @param {Record<string, unknown>} field */
  _appendField(field) {
    const id = String(field.id ?? field.name ?? 'field')
    const label = document.createElement('label')
    label.style.display = 'block'
    label.style.marginBottom = '8px'
    label.textContent = String(field.label ?? id)

    let input
    const type = String(field.type ?? 'text').toLowerCase()
    if (type === 'toggle' || type === 'boolean') {
      input = document.createElement('input')
      input.type = 'checkbox'
      input.name = id
    } else if (type === 'slider' || type === 'float') {
      input = document.createElement('input')
      input.type = 'range'
      input.name = id
      if (field.min != null) input.min = String(field.min)
      if (field.max != null) input.max = String(field.max)
    } else if (type === 'enum' || type === 'dropdown') {
      input = document.createElement('select')
      input.name = id
      const values = field.possibleValues ?? field.values ?? []
      for (const v of values) {
        const opt = document.createElement('option')
        opt.value = String(v)
        opt.textContent = String(v)
        input.appendChild(opt)
      }
    } else {
      input = document.createElement('input')
      input.type = 'text'
      input.name = id
    }
    label.appendChild(document.createElement('br'))
    label.appendChild(input)
    this._form.appendChild(label)
  }

  hide() {
    this._overlay.style.display = 'none'
    this._onSubmit = null
  }

  destroy() {
    this._overlay.remove()
  }
}
