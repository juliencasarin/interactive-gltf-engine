import { isGltfAssetEntry, isScriptAssetEntry } from './assetUtils'
import { handleSetScriptInputs } from './mcpSetScriptInputs'
import { safeInteractionSerializedProps } from './projectIo'
import { compareAuthoringBounds } from './boundsCompare'
import { getViewportCameraSummary } from './editorViewportState'
import { setTransformInSpace, type TransformSpace, type TRS } from './transformMath'
import type { AuthoringBoundsMetadata, EditorNode, InteractionSerializedPropsMap, ProjectAssetEntry, Vec3 } from './types'

export type EditorMcpCommandError = {
  code: string
  message: string
  userMessage?: string
  userAction?: string
}

export const SCENE_MUTATION_COMMANDS = new Set([
  'create_empty_node',
  'set_node_transform',
  'apply_transform_batch',
  'undo_last_change',
  'reparent_node',
  'rename_node',
  'set_node_visibility',
  'instantiate_asset',
  'delete_nodes',
  'set_description',
  'add_script_attachment',
  'remove_script_attachment',
  'update_script_attachment',
  'set_script_inputs',
])

/** True when the command mutates project/scene state (not pure viewport measure). */
export function isSceneMutationCommand(op: string, params: Record<string, unknown>): boolean {
  if (
    op === 'measure_scene_node_bounds' ||
    op === 'measure_asset_bounds' ||
    op === 'measure_scene_subtree_bounds' ||
    op === 'compare_bounds'
  ) {
    return params.persist === true
  }
  if (op === 'apply_transform_batch') {
    return params.dry_run !== true
  }
  return SCENE_MUTATION_COMMANDS.has(op)
}

export function sceneMutationBlockedError(): EditorMcpCommandError {
  return {
    code: 'mcp_scene_edition_disabled',
    message: 'MCP scene edition is disabled for this project.',
    userMessage: 'Scene edition via MCP is disabled (read-only mode).',
    userAction:
      'In igltf-editor: Settings → enable “Allow scene edition”, then retry. Do not edit project.json as a workaround.',
  }
}

export type EditorMcpCommandResult =
  | { ok: true; revision: number; result?: unknown }
  | { ok: false; error: EditorMcpCommandError }

export type EditorMcpCommandHandlers = {
  getRevision: () => number
  getNodes: () => EditorNode[]
  getProjectAssets: () => ProjectAssetEntry[]
  updateNode: (
    id: string,
    patch: Partial<
      Pick<
        EditorNode,
        | 'position'
        | 'rotation'
        | 'scale'
        | 'name'
        | 'visible'
        | 'layerId'
        | 'description'
        | 'authoringBounds'
        | 'assetRef'
        | 'sourceAssetRef'
        | 'sourceGltfNodeIndex'
      >
    >,
  ) => void
  updateProjectAsset: (
    assetId: string,
    patch: Partial<Pick<ProjectAssetEntry, 'name' | 'description' | 'authoringBounds'>>,
  ) => void
  reparentSceneNode: (nodeId: string, newParentId: string, opts?: { keepWorldPosition?: boolean }) => void
  placeSceneNodeInHierarchy: (
    nodeId: string,
    parentId: string,
    insertBeforeSiblingId: string | null,
    opts?: { keepWorldPosition?: boolean },
  ) => void
  addSceneNodeFromAsset: (
    assetId: string,
    opts?: { parentId?: string; worldPosition?: Vec3; name?: string },
  ) => string | null
  addEmptySceneNode: (opts?: { parentId?: string; position?: Vec3; name?: string }) => string | null
  deleteSceneSubtrees: (rootIds: string[]) => void
  addInteractionAttachment: (nodeId: string, scriptAssetId: string) => string | null
  removeInteractionAttachment: (nodeId: string, attachmentId: string) => void
  updateInteractionAttachment: (
    nodeId: string,
    attachmentId: string,
    patch: Partial<{ scriptAssetRef: string; serializedProps: InteractionSerializedPropsMap }>,
  ) => void
  measureSceneNodeBounds: (nodeId: string, space: 'local' | 'world') => AuthoringBoundsMetadata | null
  measureSceneSubtreeBounds: (
    descendantNodeIds: string[],
    space: 'local' | 'world',
  ) => AuthoringBoundsMetadata | null
  measureAssetBounds: (assetId: string) => AuthoringBoundsMetadata | null
  applyTransformBatch: (
    updates: Array<{
      nodeId: string
      position?: Vec3
      rotation?: Vec3
      scale?: Vec3
    }>,
    space: TransformSpace,
    opts?: { dryRun?: boolean; transactionLabel?: string },
  ) => {
    wouldAffect: number
    resolvedTransforms: Array<{ nodeId: string; local: TRS; world?: TRS }>
    errors: Array<{ nodeId: string; code: string; message: string }>
  }
  undoLastChange: () => boolean
  fetchScriptSource: (assetId: string) => Promise<string>
}

function fail(code: string, message: string): EditorMcpCommandResult {
  return { ok: false, error: { code, message } }
}

function ok(revision: number, result?: unknown): EditorMcpCommandResult {
  return { ok: true, revision, ...(result !== undefined ? { result } : {}) }
}

function collectDescendantIds(nodes: EditorNode[], rootId: string): string[] {
  const out: string[] = []
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    for (const n of nodes) {
      if (n.parentId === id) stack.push(n.id)
    }
  }
  return out
}

function vec3(raw: unknown, label: string): Vec3 | EditorMcpCommandError {
  if (!Array.isArray(raw) || raw.length !== 3) {
    return { code: 'invalid_argument', message: `${label} must be [x,y,z]` }
  }
  const nums = raw.map((v) => Number(v))
  if (nums.some((n) => !Number.isFinite(n))) {
    return { code: 'invalid_argument', message: `${label} must contain finite numbers` }
  }
  return [nums[0]!, nums[1]!, nums[2]!]
}

export function dispatchEditorMcpCommand(
  op: string,
  params: Record<string, unknown>,
  handlers: EditorMcpCommandHandlers,
): EditorMcpCommandResult | Promise<EditorMcpCommandResult> {
  if (op === 'set_script_inputs') {
    return handleSetScriptInputs(params, handlers)
  }

  switch (op) {
    case 'create_empty_node': {
      const nodes = handlers.getNodes()
      const parentId =
        typeof params.parentId === 'string' && params.parentId
          ? params.parentId
          : nodes.find((n) => n.parentId === null)?.id ?? 'root'
      if (!nodes.some((n) => n.id === parentId)) {
        return fail('node_not_found', `Parent node ${parentId} not found`)
      }
      const name = typeof params.name === 'string' ? params.name.trim() : undefined
      let position: Vec3 | undefined
      if (params.position !== undefined) {
        const p = vec3(params.position, 'position')
        if ('code' in p) return fail(p.code, p.message)
        position = p
      }
      const nodeId = handlers.addEmptySceneNode({ parentId, position, name })
      if (!nodeId) return fail('create_node_failed', 'Could not create empty node')
      return ok(handlers.getRevision(), { nodeId })
    }

    case 'apply_transform_batch': {
      const rawUpdates = params.updates
      if (!Array.isArray(rawUpdates) || !rawUpdates.length) {
        return fail('invalid_argument', 'updates must be a non-empty array')
      }
      const space = (params.space === 'world' ? 'world' : 'local') as TransformSpace
      const dryRun = params.dry_run === true
      const transactionLabel =
        typeof params.transaction_label === 'string' ? params.transaction_label : undefined
      const parsed: Array<{
        nodeId: string
        position?: Vec3
        rotation?: Vec3
        scale?: Vec3
      }> = []
      for (const raw of rawUpdates) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return fail('invalid_argument', 'each update must be an object with nodeId')
        }
        const u = raw as Record<string, unknown>
        const nodeId = typeof u.nodeId === 'string' ? u.nodeId : ''
        if (!nodeId) return fail('invalid_argument', 'each update requires nodeId')
        const entry: {
          nodeId: string
          position?: Vec3
          rotation?: Vec3
          scale?: Vec3
        } = { nodeId }
        if (u.position !== undefined) {
          const p = vec3(u.position, 'position')
          if ('code' in p) return fail(p.code, p.message)
          entry.position = p
        }
        if (u.rotation !== undefined) {
          const r = vec3(u.rotation, 'rotation')
          if ('code' in r) return fail(r.code, r.message)
          entry.rotation = r
        }
        if (u.scale !== undefined) {
          const s = vec3(u.scale, 'scale')
          if ('code' in s) return fail(s.code, s.message)
          entry.scale = s
        }
        if (!entry.position && !entry.rotation && !entry.scale) {
          return fail('invalid_argument', `update for ${nodeId} needs position, rotation, or scale`)
        }
        parsed.push(entry)
      }
      const result = handlers.applyTransformBatch(parsed, space, { dryRun, transactionLabel })
      if (!dryRun && result.errors.length) {
        return {
          ok: false,
          error: {
            code: 'batch_validation_failed',
            message: 'One or more updates failed validation',
          },
        }
      }
      return ok(handlers.getRevision(), {
        dryRun,
        transactionLabel: transactionLabel ?? null,
        wouldAffect: result.wouldAffect,
        resolvedTransforms: result.resolvedTransforms,
        errors: result.errors,
      })
    }

    case 'undo_last_change': {
      const didUndo = handlers.undoLastChange()
      if (!didUndo) return fail('nothing_to_undo', 'Editor undo stack is empty')
      return ok(handlers.getRevision(), { undone: true })
    }

    case 'set_node_transform': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      if (!nodeId) return fail('invalid_argument', 'nodeId is required')
      const nodes = handlers.getNodes()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return fail('node_not_found', `Node ${nodeId} not found`)
      const space = (params.space === 'world' ? 'world' : 'local') as TransformSpace
      const patch: Partial<{ position: Vec3; rotation: Vec3; scale: Vec3 }> = {}
      if (params.position !== undefined) {
        const p = vec3(params.position, 'position')
        if ('code' in p) return fail(p.code, p.message)
        patch.position = p
      }
      if (params.rotation !== undefined) {
        const r = vec3(params.rotation, 'rotation')
        if ('code' in r) return fail(r.code, r.message)
        patch.rotation = r
      }
      if (params.scale !== undefined) {
        const s = vec3(params.scale, 'scale')
        if ('code' in s) return fail(s.code, s.message)
        patch.scale = s
      }
      if (!Object.keys(patch).length) return fail('invalid_argument', 'At least one of position, rotation, scale required')
      const applied = setTransformInSpace(node, nodes, patch, space)
      handlers.updateNode(nodeId, applied)
      return ok(handlers.getRevision())
    }

    case 'reparent_node': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      const parentId = typeof params.parentId === 'string' ? params.parentId : ''
      if (!nodeId || !parentId) return fail('invalid_argument', 'nodeId and parentId are required')
      const keepWorldPosition = params.keepWorldPosition !== false
      const insertBefore =
        params.insertBeforeSiblingId === null || params.insertBeforeSiblingId === undefined
          ? null
          : String(params.insertBeforeSiblingId)
      if (insertBefore) {
        handlers.placeSceneNodeInHierarchy(nodeId, parentId, insertBefore, { keepWorldPosition })
      } else {
        handlers.reparentSceneNode(nodeId, parentId, { keepWorldPosition })
      }
      return ok(handlers.getRevision())
    }

    case 'rename_node': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      const name = typeof params.name === 'string' ? params.name.trim() : ''
      if (!nodeId || !name) return fail('invalid_argument', 'nodeId and name are required')
      handlers.updateNode(nodeId, { name })
      return ok(handlers.getRevision())
    }

    case 'set_node_visibility': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      if (!nodeId) return fail('invalid_argument', 'nodeId is required')
      const visible = params.visible === true
      handlers.updateNode(nodeId, { visible: visible ? undefined : false })
      return ok(handlers.getRevision())
    }

    case 'instantiate_asset': {
      const assetId = typeof params.assetId === 'string' ? params.assetId : ''
      if (!assetId) return fail('invalid_argument', 'assetId is required')
      const entry = handlers.getProjectAssets().find((a) => a.assetId === assetId)
      if (!entry || !isGltfAssetEntry(entry)) {
        return fail('asset_not_found', `Catalog glTF asset ${assetId} not found`)
      }
      const parentId = typeof params.parentId === 'string' ? params.parentId : undefined
      let worldPosition: Vec3 | undefined
      if (params.position !== undefined) {
        const p = vec3(params.position, 'position')
        if ('code' in p) return fail(p.code, p.message)
        worldPosition = p
      }
      const name = typeof params.name === 'string' ? params.name.trim() : undefined
      const newId = handlers.addSceneNodeFromAsset(assetId, { parentId, worldPosition, name })
      if (!newId) return fail('instantiate_failed', 'Could not instantiate asset')
      return ok(handlers.getRevision(), { nodeId: newId })
    }

    case 'delete_nodes': {
      const raw = params.nodeIds
      if (!Array.isArray(raw) || !raw.length) return fail('invalid_argument', 'nodeIds must be a non-empty array')
      const nodeIds = raw.filter((x): x is string => typeof x === 'string' && x !== 'root')
      if (!nodeIds.length) return fail('invalid_argument', 'No deletable node ids')
      handlers.deleteSceneSubtrees(nodeIds)
      return ok(handlers.getRevision())
    }

    case 'set_description': {
      const target = params.target === 'asset' ? 'asset' : params.target === 'node' ? 'node' : null
      const id = typeof params.id === 'string' ? params.id : ''
      const description = typeof params.description === 'string' ? params.description : ''
      if (!target || !id) return fail('invalid_argument', 'target (node|asset) and id are required')
      if (target === 'node') {
        if (!handlers.getNodes().some((n) => n.id === id)) {
          return fail('node_not_found', `Node ${id} not found`)
        }
        handlers.updateNode(id, { description: description.trim() || undefined })
      } else {
        if (!handlers.getProjectAssets().some((a) => a.assetId === id)) {
          return fail('asset_not_found', `Asset ${id} not found`)
        }
        handlers.updateProjectAsset(id, { description: description.trim() || undefined })
      }
      return ok(handlers.getRevision())
    }

    case 'add_script_attachment': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      const scriptAssetId = typeof params.scriptAssetId === 'string' ? params.scriptAssetId : ''
      if (!nodeId || !scriptAssetId) return fail('invalid_argument', 'nodeId and scriptAssetId are required')
      const node = handlers.getNodes().find((n) => n.id === nodeId)
      if (!node) return fail('node_not_found', `Node ${nodeId} not found`)
      const script = handlers.getProjectAssets().find((a) => a.assetId === scriptAssetId)
      if (!script || !isScriptAssetEntry(script)) {
        return fail('asset_not_found', `Script asset ${scriptAssetId} not found`)
      }
      const attachmentId = handlers.addInteractionAttachment(nodeId, scriptAssetId)
      if (!attachmentId) return fail('add_script_failed', 'Could not add script attachment')
      const props = safeInteractionSerializedProps(params.serializedProps)
      if (props) handlers.updateInteractionAttachment(nodeId, attachmentId, { serializedProps: props })
      return ok(handlers.getRevision(), { attachmentId })
    }

    case 'remove_script_attachment': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId : ''
      if (!nodeId || !attachmentId) return fail('invalid_argument', 'nodeId and attachmentId are required')
      handlers.removeInteractionAttachment(nodeId, attachmentId)
      return ok(handlers.getRevision())
    }

    case 'update_script_attachment': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId : ''
      if (!nodeId || !attachmentId) return fail('invalid_argument', 'nodeId and attachmentId are required')
      const patch: Partial<{ scriptAssetRef: string; serializedProps: InteractionSerializedPropsMap }> = {}
      if (typeof params.scriptAssetId === 'string') patch.scriptAssetRef = params.scriptAssetId
      const props = safeInteractionSerializedProps(params.serializedProps)
      if (props) patch.serializedProps = props
      if (!Object.keys(patch).length) return fail('invalid_argument', 'serializedProps or scriptAssetId required')
      handlers.updateInteractionAttachment(nodeId, attachmentId, patch)
      return ok(handlers.getRevision())
    }

    case 'measure_scene_node_bounds': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      if (!nodeId) return fail('invalid_argument', 'nodeId is required')
      if (!handlers.getNodes().some((n) => n.id === nodeId)) {
        return fail('node_not_found', `Node ${nodeId} not found`)
      }
      const space = params.space === 'local' ? 'local' : 'world'
      const bounds = handlers.measureSceneNodeBounds(nodeId, space)
      if (!bounds) {
        return fail(
          'bounds_unavailable',
          'Could not measure bounds (no viewport mesh for this node, or empty geometry)',
        )
      }
      const persist = params.persist === true
      if (persist) {
        handlers.updateNode(nodeId, { authoringBounds: bounds })
      }
      return ok(handlers.getRevision(), { bounds, persisted: persist })
    }

    case 'measure_scene_subtree_bounds': {
      const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
      if (!nodeId) return fail('invalid_argument', 'nodeId is required')
      const nodes = handlers.getNodes()
      if (!nodes.some((n) => n.id === nodeId)) {
        return fail('node_not_found', `Node ${nodeId} not found`)
      }
      const space = params.space === 'local' ? 'local' : 'world'
      const descendantIds = collectDescendantIds(nodes, nodeId)
      const bounds = handlers.measureSceneSubtreeBounds(descendantIds, space)
      if (!bounds) {
        return fail(
          'bounds_unavailable',
          'Could not measure subtree bounds (no viewport geometry under this node)',
        )
      }
      const persist = params.persist === true
      if (persist) {
        handlers.updateNode(nodeId, { authoringBounds: bounds })
      }
      return ok(handlers.getRevision(), { bounds, descendantCount: descendantIds.length, persisted: persist })
    }

    case 'compare_bounds': {
      const target = params.target === 'asset' ? 'asset' : params.target === 'subtree' ? 'subtree' : 'node'
      const idA = typeof params.a === 'string' ? params.a : typeof params.idA === 'string' ? params.idA : ''
      const idB = typeof params.b === 'string' ? params.b : typeof params.idB === 'string' ? params.idB : ''
      if (!idA || !idB) return fail('invalid_argument', 'a and b ids are required')
      const space = params.space === 'local' ? 'local' : 'world'
      const nodes = handlers.getNodes()
      let boundsA: AuthoringBoundsMetadata | null = null
      let boundsB: AuthoringBoundsMetadata | null = null
      if (target === 'asset') {
        const assets = handlers.getProjectAssets()
        if (!assets.some((a) => a.assetId === idA)) return fail('asset_not_found', `Asset ${idA} not found`)
        if (!assets.some((a) => a.assetId === idB)) return fail('asset_not_found', `Asset ${idB} not found`)
        boundsA = handlers.measureAssetBounds(idA)
        boundsB = handlers.measureAssetBounds(idB)
      } else if (target === 'subtree') {
        if (!nodes.some((n) => n.id === idA)) return fail('node_not_found', `Node ${idA} not found`)
        if (!nodes.some((n) => n.id === idB)) return fail('node_not_found', `Node ${idB} not found`)
        boundsA = handlers.measureSceneSubtreeBounds(collectDescendantIds(nodes, idA), space)
        boundsB = handlers.measureSceneSubtreeBounds(collectDescendantIds(nodes, idB), space)
      } else {
        if (!nodes.some((n) => n.id === idA)) return fail('node_not_found', `Node ${idA} not found`)
        if (!nodes.some((n) => n.id === idB)) return fail('node_not_found', `Node ${idB} not found`)
        boundsA = handlers.measureSceneNodeBounds(idA, space)
        boundsB = handlers.measureSceneNodeBounds(idB, space)
      }
      if (!boundsA || !boundsB) {
        return fail('bounds_unavailable', 'Could not measure one or both bounds targets in the viewport')
      }
      return ok(handlers.getRevision(), {
        target,
        a: { id: idA, bounds: boundsA },
        b: { id: idB, bounds: boundsB },
        comparison: compareAuthoringBounds(boundsA, boundsB),
      })
    }

    case 'get_viewport_camera_summary': {
      const summary = getViewportCameraSummary()
      if (!summary) {
        return fail('viewport_unavailable', 'Editor viewport camera is not active')
      }
      const roots = handlers
        .getNodes()
        .filter((n) => n.parentId === null)
        .map((n) => ({ id: n.id, name: n.name, visible: n.visible !== false }))
      return ok(handlers.getRevision(), { camera: summary, visibleRoots: roots })
    }

    case 'measure_asset_bounds': {
      const assetId = typeof params.assetId === 'string' ? params.assetId : ''
      if (!assetId) return fail('invalid_argument', 'assetId is required')
      const entry = handlers.getProjectAssets().find((a) => a.assetId === assetId)
      if (!entry || !isGltfAssetEntry(entry)) {
        return fail('asset_not_found', `Catalog glTF asset ${assetId} not found`)
      }
      const bounds = handlers.measureAssetBounds(assetId)
      if (!bounds) {
        return fail(
          'bounds_unavailable',
          'Could not measure bounds (asset not loaded in viewport, or empty geometry)',
        )
      }
      const persist = params.persist === true
      if (persist) {
        handlers.updateProjectAsset(assetId, { authoringBounds: bounds })
      }
      return ok(handlers.getRevision(), { bounds, persisted: persist })
    }

    default:
      return fail('unknown_op', `Unknown command op: ${op}`)
  }
}
