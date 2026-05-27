import { describe, expect, it, vi } from 'vitest'
import { dispatchEditorMcpCommand, type EditorMcpCommandHandlers } from './editorMcpCommands'
import type { AuthoringBoundsMetadata, EditorNode, ProjectAssetEntry } from './types'

const sampleBounds: AuthoringBoundsMetadata = {
  space: 'world',
  aabb: {
    min: [0, 0, 0],
    max: [1, 1, 1],
    center: [0.5, 0.5, 0.5],
    size: [1, 1, 1],
  },
  sphere: { center: [0.5, 0.5, 0.5], radius: 0.866025 },
  measuredAt: '2026-05-22T12:00:00.000Z',
}

function makeHandlers(overrides: Partial<EditorMcpCommandHandlers> = {}): EditorMcpCommandHandlers {
  const nodes: EditorNode[] = [
    {
      id: 'root',
      name: 'Scene',
      parentId: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    {
      id: 'n1',
      name: 'Box',
      parentId: 'root',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  ]
  const assets: ProjectAssetEntry[] = [
    {
      assetId: 'script1',
      relativePath: 'assets/Foo.js',
      assetKind: 'script',
      scriptExports: ['Foo'],
    },
  ]

  return {
    getRevision: () => 5,
    getNodes: () => nodes,
    getProjectAssets: () => assets,
    updateNode: vi.fn(),
    updateProjectAsset: vi.fn(),
    reparentSceneNode: vi.fn(),
    placeSceneNodeInHierarchy: vi.fn(),
    addSceneNodeFromAsset: vi.fn(() => 'new-node'),
    addEmptySceneNode: vi.fn(() => 'empty-node'),
    deleteSceneSubtrees: vi.fn(),
    addInteractionAttachment: vi.fn(() => 'att-1'),
    removeInteractionAttachment: vi.fn(),
    updateInteractionAttachment: vi.fn(),
    measureSceneNodeBounds: vi.fn(() => sampleBounds),
    measureSceneSubtreeBounds: vi.fn(() => sampleBounds),
    measureAssetBounds: vi.fn(() => null),
    applyTransformBatch: vi.fn(() => ({
      wouldAffect: 1,
      resolvedTransforms: [
        {
          nodeId: 'n1',
          local: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
        },
      ],
      errors: [],
    })),
    undoLastChange: vi.fn(() => true),
    fetchScriptSource: vi.fn(async () => ''),
    ...overrides,
  }
}

describe('dispatchEditorMcpCommand', () => {
  it('create_empty_node creates an empty child under root by default', async () => {
    const h = makeHandlers()
    const res = await Promise.resolve(
      dispatchEditorMcpCommand('create_empty_node', { name: 'Anchor', position: [1, 2, 3] }, h),
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.result).toEqual({ nodeId: 'empty-node' })
    expect(h.addEmptySceneNode).toHaveBeenCalledWith({
      parentId: 'root',
      name: 'Anchor',
      position: [1, 2, 3],
    })
  })

  it('create_empty_node rejects missing parent', async () => {
    const h = makeHandlers()
    const res = await Promise.resolve(
      dispatchEditorMcpCommand('create_empty_node', { parentId: 'missing' }, h),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('node_not_found')
  })

  it('rename_node calls updateNode', async () => {
    const h = makeHandlers()
    const res = await Promise.resolve(dispatchEditorMcpCommand('rename_node', { nodeId: 'n1', name: 'Renamed' }, h))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.revision).toBe(5)
    expect(h.updateNode).toHaveBeenCalledWith('n1', { name: 'Renamed' })
  })

  it('set_description on asset uses updateProjectAsset', async () => {
    const h = makeHandlers()
    const res = await Promise.resolve(
      dispatchEditorMcpCommand(
        'set_description',
        { target: 'asset', id: 'script1', description: 'Teleport script' },
        h,
      ),
    )
    expect(res.ok).toBe(true)
    expect(h.updateProjectAsset).toHaveBeenCalledWith('script1', { description: 'Teleport script' })
  })

  it('add_script_attachment validates script asset', async () => {
    const h = makeHandlers()
    const bad = await Promise.resolve(
      dispatchEditorMcpCommand(
        'add_script_attachment',
        { nodeId: 'n1', scriptAssetId: 'missing' },
        h,
      ),
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('asset_not_found')
  })

  it('measure_scene_node_bounds persists when requested', async () => {
    const h = makeHandlers()
    const res = await Promise.resolve(
      dispatchEditorMcpCommand(
        'measure_scene_node_bounds',
        { nodeId: 'n1', space: 'world', persist: true },
        h,
      ),
    )
    expect(res.ok).toBe(true)
    expect(h.measureSceneNodeBounds).toHaveBeenCalledWith('n1', 'world')
    expect(h.updateNode).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ authoringBounds: expect.objectContaining({ space: 'world' }) }),
    )
  })

  it('measure_scene_node_bounds read-only skips updateNode', async () => {
    const h = makeHandlers()
    const res = await Promise.resolve(
      dispatchEditorMcpCommand(
        'measure_scene_node_bounds',
        { nodeId: 'n1', persist: false },
        h,
      ),
    )
    expect(res.ok).toBe(true)
    expect(h.updateNode).not.toHaveBeenCalled()
  })
})

describe('isSceneMutationCommand', () => {
  it('treats persist measure as mutation', async () => {
    const { isSceneMutationCommand } = await import('./editorMcpCommands')
    expect(isSceneMutationCommand('measure_scene_node_bounds', { persist: true })).toBe(true)
    expect(isSceneMutationCommand('measure_scene_node_bounds', { persist: false })).toBe(false)
    expect(isSceneMutationCommand('create_empty_node', {})).toBe(true)
    expect(isSceneMutationCommand('set_node_transform', {})).toBe(true)
    expect(isSceneMutationCommand('set_script_inputs', {})).toBe(true)
  })
})

const DOOR_OPENER_SOURCE = `
export class DoorOpener {
  /** @igltfInput { "kind": "node" } */
  doorTarget = null

  onLoaded() {}
}
`

describe('set_script_inputs', () => {
  const scriptAssets: ProjectAssetEntry[] = [
    {
      assetId: 'script-door',
      relativePath: 'assets/DoorOpener.js',
      assetKind: 'script',
      scriptExports: ['DoorOpener'],
    },
  ]

  it('validates and merges annotated fields', async () => {
    const nodes: EditorNode[] = [
      {
        id: 'root',
        name: 'Scene',
        parentId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: 'n-host',
        name: 'Host',
        parentId: 'root',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        interactionAttachments: [
          { id: 'att-1', scriptAssetRef: 'script-door', serializedProps: {} },
        ],
      },
      {
        id: 'n-door',
        name: 'Door',
        parentId: 'root',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]
    const h = makeHandlers({
      getNodes: () => nodes,
      getProjectAssets: () => scriptAssets,
      fetchScriptSource: vi.fn(async () => DOOR_OPENER_SOURCE),
    })
    const res = await dispatchEditorMcpCommand(
      'set_script_inputs',
      {
        nodeId: 'n-host',
        attachmentId: 'att-1',
        inputs: [{ field: 'doorTarget', value: { nodeId: 'n-door' } }],
      },
      h,
    )
    expect(res.ok).toBe(true)
    expect(h.updateInteractionAttachment).toHaveBeenCalledWith('n-host', 'att-1', {
      serializedProps: { doorTarget: { kind: 'node', id: 'n-door' } },
    })
  })

  it('apply_transform_batch dry_run does not require mutation handlers beyond preview', async () => {
    const h = makeHandlers({
      applyTransformBatch: vi.fn(() => ({
        wouldAffect: 1,
        resolvedTransforms: [
          {
            nodeId: 'n1',
            local: { position: [2, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
          },
        ],
        errors: [],
      })),
    })
    const res = await Promise.resolve(
      dispatchEditorMcpCommand(
        'apply_transform_batch',
        {
          dry_run: true,
          space: 'local',
          updates: [{ nodeId: 'n1', position: [2, 0, 0] }],
        },
        h,
      ),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect((res.result as { dryRun: boolean }).dryRun).toBe(true)
      expect((res.result as { wouldAffect: number }).wouldAffect).toBe(1)
    }
    expect(h.applyTransformBatch).toHaveBeenCalledWith(
      [{ nodeId: 'n1', position: [2, 0, 0] }],
      'local',
      { dryRun: true, transactionLabel: undefined },
    )
  })

  it('undo_last_change reports failure when stack empty', async () => {
    const h = makeHandlers({ undoLastChange: vi.fn(() => false) })
    const res = await Promise.resolve(dispatchEditorMcpCommand('undo_last_change', {}, h))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('nothing_to_undo')
  })

  it('rejects unknown node ref', async () => {
    const nodes: EditorNode[] = [
      {
        id: 'root',
        name: 'Scene',
        parentId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: 'n-host',
        name: 'Host',
        parentId: 'root',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        interactionAttachments: [{ id: 'att-1', scriptAssetRef: 'script-door', serializedProps: {} }],
      },
    ]
    const h = makeHandlers({
      getNodes: () => nodes,
      getProjectAssets: () => scriptAssets,
      fetchScriptSource: vi.fn(async () => DOOR_OPENER_SOURCE),
    })
    const res = await dispatchEditorMcpCommand(
      'set_script_inputs',
      {
        nodeId: 'n-host',
        attachmentId: 'att-1',
        inputs: [{ field: 'doorTarget', value: { nodeId: 'missing' } }],
      },
      h,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('validation_failed')
  })
})
