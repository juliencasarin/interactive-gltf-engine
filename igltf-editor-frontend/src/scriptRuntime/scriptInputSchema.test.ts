import { describe, expect, it } from 'vitest'

import {
  coerceInputValue,
  parseIgltfInputAnnotations,
  remapNodeRefsInSerializedProps,
  safeInteractionSerializedProps,
  validateInputValue,
  type ScriptInputField,
} from './scriptInputSchema'

const SAMPLE = `
export class DoorOpener {
  /** @igltfInput { "kind": "node" } */
  doorTarget = null

  /** @igltfInput { "kind": "script", "exportName": "DoorController" } */
  doorScript = null

  /** @igltfInput { "kind": "scriptAttachment", "exportName": "RotateWheel" } */
  wheelBehaviour = null

  /** @igltfInput { "kind": "gltfAsset" } */
  meshAsset = null

  /** @igltfInput { "kind": "object", "fields": { "speed": { "kind": "number" } } } */
  tuning = { speed: 1 }

  label = 'hello'
}
`

describe('parseIgltfInputAnnotations', () => {
  it('parses all four kinds', () => {
    const map = parseIgltfInputAnnotations(SAMPLE, 'DoorOpener')
    expect(map.get('doorTarget')?.kind).toBe('node')
    expect(map.get('doorScript')?.exportName).toBe('DoorController')
    expect(map.get('wheelBehaviour')?.kind).toBe('scriptAttachment')
    expect(map.get('meshAsset')?.kind).toBe('gltfAsset')
    expect(map.get('tuning')?.fields?.speed?.kind).toBe('number')
    expect(map.has('label')).toBe(false)
  })
})

describe('coerceInputValue', () => {
  const nodeField: ScriptInputField = {
    key: 'doorTarget',
    valueType: 'null',
    defaultValue: null,
    inputKind: 'node',
    inputDef: { kind: 'node' },
  }

  it('coerces semantic nodeId', () => {
    expect(coerceInputValue(nodeField, { nodeId: 'n-1' })).toEqual({ kind: 'node', id: 'n-1' })
  })

  it('coerces script ref', () => {
    const f: ScriptInputField = {
      key: 'doorScript',
      valueType: 'null',
      defaultValue: null,
      inputKind: 'script',
      inputDef: { kind: 'script', exportName: 'DoorController' },
    }
    expect(coerceInputValue(f, { scriptAssetId: 'a1' })).toEqual({
      kind: 'script',
      assetId: 'a1',
      exportName: 'DoorController',
    })
  })

  it('coerces scriptAttachment ref', () => {
    const f: ScriptInputField = {
      key: 'wheelFL',
      valueType: 'null',
      defaultValue: null,
      inputKind: 'scriptAttachment',
      inputDef: { kind: 'scriptAttachment', exportName: 'RotateWheel' },
    }
    expect(coerceInputValue(f, { nodeId: 'n-wheel', attachmentId: 'att-1' })).toEqual({
      kind: 'scriptAttachment',
      nodeId: 'n-wheel',
      attachmentId: 'att-1',
    })
  })
})

describe('validateInputValue', () => {
  it('rejects unknown node id when context provided', () => {
    const f: ScriptInputField = {
      key: 'doorTarget',
      valueType: 'null',
      defaultValue: null,
      inputKind: 'node',
      inputDef: { kind: 'node' },
    }
    const err = validateInputValue(f, { kind: 'node', id: 'missing' }, { nodeIds: new Set(['n-1']) })
    expect(err).toMatch(/Unknown node/)
  })
})

describe('safeInteractionSerializedProps', () => {
  it('accepts typed refs and nested objects', () => {
    const props = safeInteractionSerializedProps({
      doorTarget: { kind: 'node', id: 'n-1' },
      speed: 2,
      tuning: { speed: 1 },
    })
    expect(props?.doorTarget).toEqual({ kind: 'node', id: 'n-1' })
    expect(props?.speed).toBe(2)
  })
})

describe('remapNodeRefsInSerializedProps', () => {
  it('remaps node refs in nested objects', () => {
    const out = remapNodeRefsInSerializedProps(
      { doorTarget: { kind: 'node', id: 'author-n' }, tuning: { speed: 1 } },
      (id) => (id === 'author-n' ? '3' : undefined),
    )
    expect(out?.doorTarget).toEqual({ kind: 'node', id: '3' })
  })

  it('remaps scriptAttachment nodeId', () => {
    const out = remapNodeRefsInSerializedProps(
      { wheel: { kind: 'scriptAttachment', nodeId: 'author-n', attachmentId: 'att-1' } },
      (id) => (id === 'author-n' ? '5' : undefined),
    )
    expect(out?.wheel).toEqual({ kind: 'scriptAttachment', nodeId: '5', attachmentId: 'att-1' })
  })
})
