/**
 * HTML5 DnD contract for dragging a catalog asset onto hierarchy / viewport / inspector.
 * WebView2 and some Chromium builds omit custom `application/*` entries from `dataTransfer.types`
 * during dragover — only reliably at drop — so drag targets must use heuristics (see dragOverLooksLikeAsset).
 */
export const MIME_ASSET = 'application/x-igltf-asset'

/** Must match `HierarchyPanel` drag source payloads (single source of truth). */
export const MIME_HIERARCHY_NODE = 'application/x-hierarchy-node'
/** Some browsers expose this in dragover where custom application/* types are hidden. */
export const MIME_HIERARCHY_NODE_ALT = 'text/x-igltf-hierarchy-node'
/** Fallback when custom MIME lists are hidden during dragover (Firefox / Safari). */
export const HIERARCHY_NODE_PLAINTEXT_PREFIX = 'igltf:hnode:'

export function readHierarchyNodeDragId(dt: DataTransfer | null): string {
  if (!dt) return ''
  const a = dt.getData(MIME_HIERARCHY_NODE).trim()
  if (a) return a
  const b = dt.getData(MIME_HIERARCHY_NODE_ALT).trim()
  if (b) return b
  const p = dt.getData('text/plain').trim()
  return p.startsWith(HIERARCHY_NODE_PLAINTEXT_PREFIX)
    ? p.slice(HIERARCHY_NODE_PLAINTEXT_PREFIX.length)
    : ''
}

export function dragTypeLooksLikeHierarchyNode(types: readonly string[]): boolean {
  const t = [...types]
  return t.includes(MIME_HIERARCHY_NODE) || t.includes(MIME_HIERARCHY_NODE_ALT)
}

/**
 * During dragenter/dragover on a target that accepts a hierarchy row reference (e.g. interaction targetId).
 */
export function dragOverLooksLikeHierarchyNode(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return dragTypeLooksLikeHierarchyNode(dt.types)
}

function hasStringPlainListed(types: readonly string[]): boolean {
  return types.some((t) => t === 'text/plain' || t === 'Text')
}

/**
 * During `dragenter`/`dragover`, decide if we should preventDefault so the UI can drop.
 */
export function dragOverLooksLikeAsset(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const types = [...dt.types]
  if (types.includes(MIME_ASSET)) return true

  if (!hasStringPlainListed(types)) return false

  if (!types.includes('Files')) return true

  try {
    const items = [...(dt.items ?? [])]
    if (items.length === 0) return false
    if (items.every((i) => i.kind === 'string')) return true
    if (items.some((i) => i.kind === 'file')) return false
  } catch {
    return false
  }

  return true
}
