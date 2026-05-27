import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeInteractionKind } from '../src/interaction-runtime-contract.js'
import { buildRegistriesFromGltfNodes } from '../src/runtime-dispatch.js'
import {
  associateInteractionAndInput,
  createUiPlaceholderInput,
  isHoldEvent,
} from '../src/pc-input-layer.js'

describe('normalizeInteractionKind', () => {
  it('marks drawing unsupported', () => {
    assert.equal(normalizeInteractionKind('drawing'), 'unsupported')
  })
})

describe('buildRegistriesFromGltfNodes', () => {
  it('lets serializedProps.hold enable event hold even when dto defaults false', () => {
    const { interactionRegistry } = buildRegistriesFromGltfNodes([
      {
        extensions: {
          EXT_IGLTF_UMI3D_PROTO: {
            umi3d: {
              attachments: [
                {
                  attachmentId: 'att-hold',
                  scriptHandlerId: 'HoldButton',
                  interactionKind: 'event',
                  dto: { interactionType: 'event', hold: false },
                  serializedProps: { hold: true },
                },
              ],
            },
          },
        },
      },
    ])

    const interaction = interactionRegistry.get('att-hold')
    assert.equal(interaction.dto.hold, true)
    assert.equal(isHoldEvent(interaction), true)
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
