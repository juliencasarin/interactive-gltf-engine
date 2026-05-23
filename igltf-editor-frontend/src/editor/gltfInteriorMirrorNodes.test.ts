import { describe, expect, it } from 'vitest'
import type { GltfInteriorManifest } from '@/api/projectApi'
import { buildInteriorMirrorNodesFromManifest } from './gltfInteriorMirrorNodes'
import { resolveInteriorHostPlacementId } from './interiorPlacementContext'
import type { EditorNode } from './types'

describe('buildInteriorMirrorNodesFromManifest', () => {
  it('tags mirror rows with sourcePlacementId for duplicate catalogue instances', () => {
    const placementA = 'placement-a'
    const placementB = 'placement-b'
    const catalogId = 'cat-buggy'

    const manifest: GltfInteriorManifest = {
      assetId: catalogId,
      defaultSceneRoots: [0],
      preorderIndices: [0, 1],
      nodes: [
        { index: 0, name: 'Root', parentIndex: null, hasMesh: false, hasSkin: false },
        { index: 1, name: 'Wheel', parentIndex: 0, hasMesh: true, hasSkin: false },
      ],
    }
    const mirrorsA = buildInteriorMirrorNodesFromManifest(placementA, catalogId, manifest)
    const mirrorsB = buildInteriorMirrorNodesFromManifest(placementB, catalogId, manifest)

    expect(mirrorsA.every((n) => n.sourcePlacementId === placementA)).toBe(true)
    expect(mirrorsB.every((n) => n.sourcePlacementId === placementB)).toBe(true)

    const nodes: EditorNode[] = [
      {
        id: placementA,
        name: 'Buggy 1',
        parentId: 'root',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        assetRef: catalogId,
      },
      {
        id: placementB,
        name: 'Buggy 2',
        parentId: 'root',
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        assetRef: catalogId,
      },
      ...mirrorsA,
      ...mirrorsB,
    ]

    const wheelA = mirrorsA.find((n) => n.name === 'Wheel')!
    const wheelB = mirrorsB.find((n) => n.name === 'Wheel')!

    expect(resolveInteriorHostPlacementId(nodes, wheelA)).toBe(placementA)
    expect(resolveInteriorHostPlacementId(nodes, wheelB)).toBe(placementB)
  })
})
