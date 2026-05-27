/**
 * PC input policy (ported from BrowserControllerManager.MouseSelectorDataDelegate).
 */

/**
 * @typedef {Object} BoundInput
 * @property {string} id
 * @property {'mouseLeft'|'keyboard'|'uiButton'|'uiDouble'|'uiPlaceholder'} source
 * @property {string} [key]
 * @property {() => void} [clear]
 * @property {(fn: () => void) => void} onStarted
 * @property {(fn: () => void) => void} onCanceled
 * @property {(fn: (value: unknown) => void) => void} onPerformed
 */

const KEYBOARD_EVENT_KEYS = ['q', 'e', 'r', 'f', 'g']

/**
 * @param {import('./interaction-registry.js').InteractionRecord} interaction
 * @returns {boolean}
 */
export function isHoldEvent(interaction) {
  return interaction.kind === 'event' && Boolean(interaction.dto?.hold)
}

/**
 * @param {import('./interaction-registry.js').InteractionRecord} interaction
 * @returns {boolean}
 */
export function isEventInteraction(interaction) {
  return interaction.kind === 'event'
}

/**
 * @returns {BoundInput[]}
 */
export function createPcEventInputs() {
  const inputs = []
  inputs.push({
    id: 'mouse:left',
    source: 'mouseLeft',
    onStarted(fn) {
      this._onStarted = fn
    },
    onCanceled(fn) {
      this._onCanceled = fn
    },
    onPerformed(fn) {
      this._onPerformed = fn
    },
    clear() {
      this._onStarted = undefined
      this._onCanceled = undefined
      this._onPerformed = undefined
    },
  })
  for (const key of KEYBOARD_EVENT_KEYS) {
    inputs.push({
      id: `keyboard:${key}`,
      source: 'keyboard',
      key,
      onStarted(fn) {
        this._onStarted = fn
      },
      onCanceled(fn) {
        this._onCanceled = fn
      },
      onPerformed(fn) {
        this._onPerformed = fn
      },
      clear() {
        this._onStarted = undefined
        this._onCanceled = undefined
        this._onPerformed = undefined
      },
    })
  }
  inputs.push(createUiPlaceholderInput('ui:event'))
  return inputs
}

/** @returns {BoundInput} */
export function createUiPlaceholderInput(id = 'ui:placeholder') {
  return {
    id,
    source: 'uiPlaceholder',
    onStarted(fn) {
      this._onStarted = fn
    },
    onCanceled(fn) {
      this._onCanceled = fn
    },
    onPerformed(fn) {
      this._onPerformed = fn
    },
    clear() {
      this._onStarted = undefined
      this._onCanceled = undefined
      this._onPerformed = undefined
    },
  }
}

/**
 * MouseSelectorDataDelegate.AssociateInteractionAndInput — simplified for web runtime.
 * @param {import('./interaction-registry.js').InteractionRecord[]} eventInteractions
 * @param {import('./interaction-registry.js').InteractionRecord[]} otherInteractions
 * @param {Map<import('./interaction-registry.js').InteractionRecord, BoundInput[]>} inputsByInteraction
 * @param {boolean} reserveLeftMouseForUi
 * @returns {Array<{interaction: import('./interaction-registry.js').InteractionRecord, input: BoundInput}>}
 */
export function associateInteractionAndInput(
  eventInteractions,
  otherInteractions,
  inputsByInteraction,
  reserveLeftMouseForUi,
) {
  /** @type {Array<{interaction: import('./interaction-registry.js').InteractionRecord, input: BoundInput}>} */
  const associations = []
  const assignedInputIds = new Set()

  const sortedEvents = [...eventInteractions].sort(
    (a, b) => Number(isHoldEvent(b)) - Number(isHoldEvent(a)),
  )

  let hasUiInput = false
  for (const interaction of otherInteractions) {
    const placeholders = inputsByInteraction.get(interaction) ?? [createUiPlaceholderInput(`ui:${interaction.id}`)]
    const input = placeholders[0]
    associations.push({ interaction, input })
    assignedInputIds.add(input.id)
    hasUiInput = true
  }

  const tryAssignEvents = () => {
    for (const eventDto of sortedEvents) {
      const candidates = inputsByInteraction.get(eventDto) ?? createPcEventInputs()
      for (const input of candidates) {
        if (assignedInputIds.has(input.id)) continue
        if (reserveLeftMouseForUi && input.source === 'mouseLeft') continue
        if (hasUiInput && input.source === 'uiPlaceholder') {
          const ui = createUiPlaceholderInput(`ui:${eventDto.id}`)
          associations.push({ interaction: eventDto, input: ui })
          assignedInputIds.add(ui.id)
          hasUiInput = true
          break
        }
        associations.push({ interaction: eventDto, input })
        assignedInputIds.add(input.id)
        break
      }
    }
  }

  if (hasUiInput) {
    tryAssignEvents()
  } else {
    tryAssignEvents()
    if (hasUiInput) {
      associations.length = 0
      assignedInputIds.clear()
      tryAssignEvents()
    }
  }

  return associations
}

/**
 * @typedef {Object} PcInputLayerState
 * @property {Set<string>} keysDown
 * @property {boolean} leftMouseDown
 * @property {BoundInput[]} activeBindings
 */

export function createPcInputLayerState() {
  return {
    keysDown: new Set(),
    leftMouseDown: false,
    activeBindings: [],
  }
}

/**
 * Wire DOM / pointer events to bound inputs on active projections.
 * @param {PcInputLayerState} state
 * @param {KeyboardEvent} e
 * @param {'down'|'up'} phase
 */
export function handleKeyboardEvent(state, e, phase) {
  const key = e.key.toLowerCase()
  if (!KEYBOARD_EVENT_KEYS.includes(key)) return
  if (phase === 'down') {
    if (state.keysDown.has(key)) return
    state.keysDown.add(key)
    for (const binding of state.activeBindings) {
      if (binding.input.source === 'keyboard' && binding.input.key === key) {
        binding.input._onStarted?.()
        if (!isHoldEvent(binding.interaction)) {
          binding.input._onPerformed?.(true)
          binding.input._onCanceled?.()
        }
      }
    }
  } else {
    state.keysDown.delete(key)
    for (const binding of state.activeBindings) {
      if (binding.input.source === 'keyboard' && binding.input.key === key) {
        if (isHoldEvent(binding.interaction)) {
          binding.input._onCanceled?.()
        }
      }
    }
  }
}

/**
 * @param {PcInputLayerState} state
 * @param {'down'|'up'} phase
 */
export function handlePrimaryPointer(state, phase) {
  if (phase === 'down') {
    if (state.leftMouseDown) return
    state.leftMouseDown = true
    for (const binding of state.activeBindings) {
      if (binding.input.source === 'mouseLeft') {
        binding.input._onStarted?.()
        if (!isHoldEvent(binding.interaction)) {
          binding.input._onPerformed?.(true)
          binding.input._onCanceled?.()
        }
      }
    }
  } else {
    state.leftMouseDown = false
    for (const binding of state.activeBindings) {
      if (binding.input.source === 'mouseLeft') {
        if (isHoldEvent(binding.interaction)) {
          binding.input._onCanceled?.()
        }
      }
    }
  }
}
