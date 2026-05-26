import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeInteractionKind } from '../src/interaction-runtime-contract.js'
import {
  associateInteractionAndInput,
  createUiPlaceholderInput,
} from '../src/pc-input-layer.js'

describe('normalizeInteractionKind', () => {
  it('marks drawing unsupported', () => {
    assert.equal(normalizeInteractionKind('drawing'), 'unsupported')
  })
})

describe('associateInteractionAndInput', () => {
  it('assigns non-event interactions to UI placeholder', () => {
    const form = {
      id: 'f1',
      kind: 'form',
      dto: {},
      scriptHandlerId: 'F',
      attachmentId: 'f1',
      serializedProps: {},
    }
    const map = new Map([[form, [createUiPlaceholderInput('ui:f1')]]])
    const assoc = associateInteractionAndInput([], [form], map, false)
    assert.equal(assoc.length, 1)
    assert.ok(assoc[0].input.id.startsWith('ui:'))
  })
})
