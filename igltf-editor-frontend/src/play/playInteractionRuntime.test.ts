import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  associateInteractionAndInput,
  createPcEventInputs,
  isHoldEvent,
  normalizeInteractionKind,
  type PlayInteractionRuntime,
} from 'igltf-engine'

import { resolveToolFromHit } from './playInteractionRuntimeBridge'

describe('interaction runtime contract', () => {
  it('maps drawing to unsupported', () => {
    expect(normalizeInteractionKind('drawing')).toBe('unsupported')
  })

  it('maps parameter aliases', () => {
    expect(normalizeInteractionKind('boolean')).toBe('parameter')
  })
})

describe('pc input association', () => {
  it('prioritizes hold events for keyboard assignment', () => {
    const hold = {
      id: 'a',
      kind: 'event' as const,
      dto: { hold: true },
      scriptHandlerId: 'h1',
      attachmentId: 'a',
      serializedProps: {},
    }
    const click = {
      id: 'b',
      kind: 'event' as const,
      dto: { hold: false },
      scriptHandlerId: 'h2',
      attachmentId: 'b',
      serializedProps: {},
    }
    expect(isHoldEvent(hold)).toBe(true)
    const map = new Map([
      [hold, createPcEventInputs()],
      [click, createPcEventInputs()],
    ])
    const assoc = associateInteractionAndInput([hold, click], [], map, false)
    expect(assoc.length).toBeGreaterThanOrEqual(1)
    const holdAssoc = assoc.find((a: { interaction: { id: string } }) => a.interaction.id === 'a')
    expect(holdAssoc?.input.id).toBeDefined()
  })

  it('keeps mouse:left for events when co-located with parameters (parameters excluded from association)', () => {
    const event = {
      id: 'e1',
      kind: 'event' as const,
      dto: { hold: false },
      scriptHandlerId: 'h1',
      attachmentId: 'e1',
      serializedProps: {},
    }
    const assoc = associateInteractionAndInput([event], [], new Map([[event, createPcEventInputs()]]), false)
    const eventAssoc = assoc.find((a) => a.interaction.id === 'e1')
    expect(eventAssoc?.input.source).toBe('mouseLeft')
  })
})

describe('resolveToolFromHit', () => {
  it('walks up to an ancestor node that owns the tool', () => {
    const mesh = new THREE.Mesh()
    mesh.userData.igltfNodeIndex = 2
    const parent = new THREE.Group()
    parent.userData.igltfNodeIndex = 1
    parent.add(mesh)

    const tool = {
      id: '1',
      gltfNodeIndex: 1,
      interactions: [],
      selectorId: null,
      isHovered: false,
    }
    const runtime = {
      toolRegistry: {
        get: (id: string) => (id === '1' ? tool : undefined),
      },
    } as unknown as PlayInteractionRuntime

    const resolved = resolveToolFromHit(mesh, runtime)
    expect(resolved?.gltfNodeIndex).toBe(1)
    expect(resolved?.tool).toBe(tool)
  })
})
