import { describe, expect, it } from 'vitest'

import type { IgltfTransactionBuilder } from './igltfHost'
import { isIgltfTransaction, normalizeIgltfTransaction } from './igltfTransactionUtils'

describe('igltfTransactionUtils', () => {
  it('isIgltfTransaction accepts v1 objects with operations array', () => {
    expect(isIgltfTransaction({ version: 1, operations: [] })).toBe(true)
    expect(isIgltfTransaction({ version: 2, operations: [] })).toBe(false)
    expect(isIgltfTransaction(null)).toBe(false)
  })

  it('normalizeIgltfTransaction accepts plain JSON and builders', () => {
    const plain = {
      version: 1 as const,
      operations: [{ kind: 'transform.setLocalPosition' as const, entityId: '1', position: { x: 0, y: 1, z: 0 } }],
    }
    expect(normalizeIgltfTransaction(plain)).toEqual(plain)

    const builder: IgltfTransactionBuilder = {
      addSetLocalPosition() {
        return builder
      },
      addSetLocalEulerDegrees() {
        return builder
      },
      addSetLocalScale() {
        return builder
      },
      addSetLocalQuaternion() {
        return builder
      },
      addSetParent() {
        return builder
      },
      addTranslate() {
        return builder
      },
      addRotate() {
        return builder
      },
      addRotateAround() {
        return builder
      },
      build: () => plain,
      toJSON: () => plain,
    }
    expect(normalizeIgltfTransaction(builder)).toEqual(plain)
    expect(normalizeIgltfTransaction(undefined)).toBeNull()
  })
})
