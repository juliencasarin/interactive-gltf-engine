import type { EditorNode, ProjectAssetEntry } from './types'

import { isGltfAssetEntry } from './assetUtils'

export type InteriorPlacementContext = { placementId: string; catalogAssetId: string }

/** Catalogue `.glb` asset ids referenced by authoring. */
export function catalogueGlbAssetIds(assets: ProjectAssetEntry[]): Set<string> {
  return new Set(
    assets
      .filter((a) => isGltfAssetEntry(a) && a.relativePath.toLowerCase().endsWith('.glb'))
      .map((a) => a.assetId),
  )
}

/** Walk upward — first catalogue placement using a `.glb` asset decides the interior authoring scope. */
export function resolveInteriorPlacementContext(
  nodes: EditorNode[],
  nodeId: string | null,
  glbCatalogIds: Set<string>,
): InteriorPlacementContext | null {
  let cur: string | null = nodeId
  const byId = new Map(nodes.map((n) => [n.id, n]))
  while (cur) {
    const en = byId.get(cur)
    if (!en) return null
    if (en.assetRef && glbCatalogIds.has(en.assetRef)) return { placementId: en.id, catalogAssetId: en.assetRef }
    cur = en.parentId
  }
  return null
}

/** First catalogue placement ancestor of `startParentId` with this asset id (walk parentId chain). */
export function cataloguePlacementAncestorId(
  nodes: EditorNode[],
  startParentId: string | null,
  catalogueAssetId: string,
): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur: string | null = startParentId
  while (cur) {
    const en = byId.get(cur)
    if (!en) return null
    if (en.assetRef === catalogueAssetId) return en.id
    cur = en.parentId ?? null
  }
  return null
}

/**
 * Which catalogue placement row owns the GLB mesh data for this mirror
 * (explicit `sourcePlacementId`, or implicit walk from `parentId`).
 */
export function resolveInteriorHostPlacementId(
  nodes: EditorNode[],
  mirror: Pick<EditorNode, 'id' | 'parentId' | 'sourceAssetRef' | 'sourceGltfNodeIndex' | 'sourcePlacementId'>,
): string | null {
  if (mirror.sourceGltfNodeIndex === undefined || !mirror.sourceAssetRef) return null
  if (mirror.sourcePlacementId) {
    const p = nodes.find((n) => n.id === mirror.sourcePlacementId && n.assetRef === mirror.sourceAssetRef)
    if (p) return p.id
  }
  return cataloguePlacementAncestorId(nodes, mirror.parentId ?? null, mirror.sourceAssetRef)
}

export function listInteriorMirrorsHostedBy(
  nodes: EditorNode[],
  placementId: string,
  catalogAssetId: string,
): EditorNode[] {
  const docIx = new Map(nodes.map((n, i) => [n.id, i]))
  return nodes
    .filter(
      (n) =>
        n.sourceAssetRef === catalogAssetId &&
        n.sourceGltfNodeIndex !== undefined &&
        resolveInteriorHostPlacementId(nodes, n) === placementId,
    )
    .sort((a, b) => {
      const da = docIx.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const db = docIx.get(b.id) ?? Number.MAX_SAFE_INTEGER
      return da !== db ? da - db : a.id.localeCompare(b.id)
    })
}

function ctxEqual(a: InteriorPlacementContext | null, b: InteriorPlacementContext | null): boolean {
  if (!a || !b) return false
  return a.placementId === b.placementId && a.catalogAssetId === b.catalogAssetId
}

/**
 * Block reparenting catalogue *placement* rows into a different GLB scope.
 * Interior mirror rows (`sourceGltfNodeIndex`) may reparent freely; use `sourcePlacementId` to retain mesh host.
 */
export function interiorReparentForbidden(
  nodes: EditorNode[],
  movingNodeId: string,
  newParentId: string,
  glbCatalogIds: Set<string>,
): boolean {
  const moved = nodes.find((n) => n.id === movingNodeId)
  if (
    moved &&
    typeof moved.sourceGltfNodeIndex === 'number' &&
    moved.sourceAssetRef
  ) {
    return false
  }
  const ctxMoved = resolveInteriorPlacementContext(nodes, movingNodeId, glbCatalogIds)
  const ctxDrop = resolveInteriorPlacementContext(nodes, newParentId, glbCatalogIds)
  if (ctxMoved) {
    return !ctxEqual(ctxMoved, ctxDrop)
  }
  return false
}

export function placementHasExpandedInterior(
  nodes: EditorNode[],
  placementId: string,
  catalogAssetId: string,
): boolean {
  return listInteriorMirrorsHostedBy(nodes, placementId, catalogAssetId).length > 0
}

/**
 * Nearest mirror ancestor whose `sourceGltfNodeIndex` already has an earlier row (duplicate instance root).
 * Descendants in the editor tree should bind to meshes inside that ancestor's Three preview clone.
 */
export function resolveInteriorDuplicateAnchorMirrorId(
  nodes: EditorNode[],
  placementId: string,
  catalogAssetId: string,
  mirrorRowId: string,
): string | null {
  const hosted = listInteriorMirrorsHostedBy(nodes, placementId, catalogAssetId)
  const mirrorIds = new Set(hosted.map((r) => r.id))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const firstAtIndex = new Map<number, string>()
  for (const r of hosted) {
    const ix = r.sourceGltfNodeIndex!
    if (!firstAtIndex.has(ix)) firstAtIndex.set(ix, r.id)
  }

  let p: string | null = byId.get(mirrorRowId)?.parentId ?? null
  while (p) {
    if (!mirrorIds.has(p)) {
      p = byId.get(p)?.parentId ?? null
      continue
    }
    const anc = byId.get(p)!
    const ix = anc.sourceGltfNodeIndex!
    const first = firstAtIndex.get(ix)
    if (first && first !== p) return p
    p = anc.parentId ?? null
  }
  return null
}

/** Mirror rows under `placementId` that are strict descendants of `mirrorRootId` in the editor tree. */
export function interiorMirrorDescendantGltfIndices(
  nodes: EditorNode[],
  placementId: string,
  catalogAssetId: string,
  mirrorRootId: string,
): Set<number> {
  const hosted = listInteriorMirrorsHostedBy(nodes, placementId, catalogAssetId)
  const mirrorIds = new Set(hosted.map((r) => r.id))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const byParent = new Map<string, string[]>()
  for (const r of hosted) {
    let p: string | null = r.parentId ?? null
    let mirrorParent: string | null = null
    while (p) {
      if (mirrorIds.has(p)) {
        mirrorParent = p
        break
      }
      p = byId.get(p)?.parentId ?? null
    }
    if (mirrorParent) {
      const list = byParent.get(mirrorParent) ?? []
      list.push(r.id)
      byParent.set(mirrorParent, list)
    }
  }
  const indices = new Set<number>()
  const stack = [...(byParent.get(mirrorRootId) ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    const row = byId.get(id)
    if (row?.sourceGltfNodeIndex !== undefined) indices.add(row.sourceGltfNodeIndex)
    stack.push(...(byParent.get(id) ?? []))
  }
  return indices
}

/** Depth among mirror rows only (0 = direct child of catalogue placement in mirror tree). */
export function interiorMirrorRowDepth(
  nodes: EditorNode[],
  placementId: string,
  catalogAssetId: string,
  mirrorRowId: string,
): number {
  const mirrorIds = new Set(
    listInteriorMirrorsHostedBy(nodes, placementId, catalogAssetId).map((r) => r.id),
  )
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let depth = 0
  let p: string | null = byId.get(mirrorRowId)?.parentId ?? null
  while (p) {
    if (mirrorIds.has(p)) depth += 1
    p = byId.get(p)?.parentId ?? null
  }
  return depth
}

/** Visible in preview if row + editor ancestors + catalogue host placement chain are visible. */
export type InteriorPickCache = {
  depthByRowId: ReadonlyMap<string, number>
  rowsByGltfIndex: ReadonlyMap<number, readonly string[]>
}

export function buildInteriorPickCache(
  nodes: EditorNode[],
  placementId: string,
  catalogAssetId: string,
): InteriorPickCache {
  const rows = listInteriorMirrorsHostedBy(nodes, placementId, catalogAssetId)
  const depthByRowId = new Map<string, number>()
  const rowsByGltfIndex = new Map<number, string[]>()
  for (const r of rows) {
    depthByRowId.set(r.id, interiorMirrorRowDepth(nodes, placementId, catalogAssetId, r.id))
    const ix = r.sourceGltfNodeIndex!
    const list = rowsByGltfIndex.get(ix) ?? []
    list.push(r.id)
    rowsByGltfIndex.set(ix, list)
  }
  return { depthByRowId, rowsByGltfIndex }
}

export function editorInteriorVisibilityEffective(nodes: EditorNode[], row: EditorNode): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let curId: string | null = row.id
  while (curId) {
    const nn = byId.get(curId)
    if (!nn || nn.visible === false) return false
    curId = nn.parentId ?? null
  }
  const hid = resolveInteriorHostPlacementId(nodes, row)
  if (!hid) return true
  curId = hid
  while (curId) {
    const nn = byId.get(curId)
    if (!nn || nn.visible === false) return false
    curId = nn.parentId ?? null
  }
  return true
}
