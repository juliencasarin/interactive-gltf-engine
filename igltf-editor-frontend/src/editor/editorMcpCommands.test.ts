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
    deleteSceneSubtrees: vi.fn(),
    addInteractionAttachment: vi.fn(() => 'att-1'),
    removeInteractionAttachment: vi.fn(),
    updateInteractionAttachment: vi.fn(),
    measureSceneNodeBounds: vi.fn(() => sampleBounds),
    measureAssetBounds: vi.fn(() => null),
    ...overrides,
  }
}

describe('dispatchEditorMcpCommand', () => {
  it('rename_node calls updateNode', () => {
    const h = makeHandlers()
    const res = dispatchEditorMcpCommand('rename_node', { nodeId: 'n1', name: 'Renamed' }, h)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.revision).toBe(5)
    expect(h.updateNode).toHaveBeenCalledWith('n1', { name: 'Renamed' })
  })

  it('set_description on asset uses updateProjectAsset', () => {
    const h = makeHandlers()
    const res = dispatchEditorMcpCommand(
      'set_description',
      { target: 'asset', id: 'script1', description: 'Teleport script' },
      h,
    )
    expect(res.ok).toBe(true)
    expect(h.updateProjectAsset).toHaveBeenCalledWith('script1', { description: 'Teleport script' })
  })

  it('add_script_attachment validates script asset', () => {
    const h = makeHandlers()
    const bad = dispatchEditorMcpCommand(
      'add_script_attachment',
      { nodeId: 'n1', scriptAssetId: 'missing' },
      h,
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('asset_not_found')
  })

  it('measure_scene_node_bounds persists when requested', () => {
    const h = makeHandlers()
    const res = dispatchEditorMcpCommand(
      'measure_scene_node_bounds',
      { nodeId: 'n1', space: 'world', persist: true },
      h,
    )
    expect(res.ok).toBe(true)
    expect(h.measureSceneNodeBounds).toHaveBeenCalledWith('n1', 'world')
    expect(h.updateNode).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ authoringBounds: expect.objectContaining({ space: 'world' }) }),
    )
  })

  it('measure_scene_node_bounds read-only skips updateNode', () => {
    const h = makeHandlers()
    const res = dispatchEditorMcpCommand(
      'measure_scene_node_bounds',
      { nodeId: 'n1', persist: false },
      h,
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
    expect(isSceneMutationCommand('set_node_transform', {})).toBe(true)
  })
})
