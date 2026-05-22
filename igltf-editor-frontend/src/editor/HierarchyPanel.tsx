import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
  type ReactElement,
  type RefObject,
} from 'react'
import { useEditor } from './EditorContext'
import { placementHasExpandedInterior } from './interiorPlacementContext'
import { isApiConfigured } from '@/api/projectApi'
import {
  MIME_ASSET,
  MIME_HIERARCHY_NODE,
  MIME_HIERARCHY_NODE_ALT,
  HIERARCHY_NODE_PLAINTEXT_PREFIX,
  readHierarchyNodeDragId,
  dragTypeLooksLikeHierarchyNode,
  dragOverLooksLikeAsset,
} from './dndTypes'
import type { EditorNode } from './types'
import './panels.css'

const readHierarchyDragId = readHierarchyNodeDragId

function hasHierarchyDrag(types: readonly string[]): boolean {
  return dragTypeLooksLikeHierarchyNode(types)
}

/** True if this is probably a hierarchy reorder drag we're allowed to treat as reorder (not external text, etc.). */
function isReorderDragEvidence(types: readonly string[], reorderVisualActive: boolean): boolean {
  if (reorderVisualActive) return true
  return hasHierarchyDrag(types)
}

function asHTMLElement(evTarget: EventTarget | null): HTMLElement | null {
  if (!evTarget) return null
  if (evTarget instanceof HTMLElement) return evTarget
  const n = evTarget as Node & { parentElement?: HTMLElement | null }
  return n.nodeType === Node.TEXT_NODE ? n.parentElement ?? null : null
}

function isReorderLaneElement(raw: EventTarget | null): boolean {
  const h = asHTMLElement(raw)
  return Boolean(h?.closest('[data-hierarchy-drop-lane]'))
}

type HierarchyDropActionCtx = {
  nodes: EditorNode[]
  dismissActiveReorderLane: () => void
  reparentSceneNode: (dragId: string, parentId: string) => void
  addSceneNodeFromAsset: (aid: string, opts: { parentId: string }) => void
}

function siblingOrderIndex(nodes: EditorNode[]): Map<string, number> {
  return new Map(nodes.map((n, i) => [n.id, i]))
}

function sortByDocumentOrder(children: EditorNode[], order: Map<string, number>): EditorNode[] {
  return [...children].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

/** Node id included if empty query or name/subtree matches. */
function subtreeMatchIds(nodes: EditorNode[], rawQuery: string): Set<string> {
  const q = rawQuery.trim().toLowerCase()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, boolean>()
  function rec(id: string): boolean {
    if (memo.has(id)) return memo.get(id)!
    const n = byId.get(id)
    if (!n) {
      memo.set(id, false)
      return false
    }
    if (!q || n.name.toLowerCase().includes(q)) {
      memo.set(id, true)
      return true
    }
    const kids = nodes.filter((x) => x.parentId === id)
    const v = kids.some((c) => rec(c.id))
    memo.set(id, v)
    return v
  }
  nodes.forEach((n) => rec(n.id))
  return new Set([...memo.entries()].filter(([, v]) => v).map(([k]) => k))
}

type HierarchyMenuState = { clientX: number; clientY: number; nodeId: string }

type HierarchyReorderLaneProps = {
  parentIdForSiblings: string
  insertBeforeSiblingId: string | null
  laneDepthPx: number
  dropLanesEnabled: boolean
  placeSceneNodeInHierarchy: (dragId: string, parentId: string, insertBeforeSiblingId: string | null) => void
  activeLaneDismissRef: MutableRefObject<(() => void) | null>
  hierarchyPanelRootRef: RefObject<HTMLDivElement | null>
}

/** Local highlight state only — avoid parent setState on every dragover (breaks native drag / spurious drops). */
const HierarchyReorderLane = memo(function HierarchyReorderLane({
  parentIdForSiblings,
  insertBeforeSiblingId,
  laneDepthPx,
  dropLanesEnabled,
  placeSceneNodeInHierarchy,
  activeLaneDismissRef,
  hierarchyPanelRootRef,
}: HierarchyReorderLaneProps) {
  const [highlight, setHighlight] = useState(false)
  const dismissHighlight = useCallback(() => setHighlight(false), [])

  return (
    <div
      data-hierarchy-drop-lane=""
      className={`hierarchyDropLane${highlight ? ' hierarchyDropLaneActive' : ''}`}
      style={{ marginLeft: laneDepthPx }}
      aria-hidden
      onDragOver={(e) => {
        const reorderVisual =
          hierarchyPanelRootRef.current?.classList.contains('hierarchyPanelRootDragging') ?? false
        if (!dropLanesEnabled || !isReorderDragEvidence(e.dataTransfer.types, reorderVisual)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        activeLaneDismissRef.current?.()
        activeLaneDismissRef.current = dismissHighlight
        setHighlight(true)
      }}
      onDrop={(e) => {
        if (!dropLanesEnabled) return
        e.preventDefault()
        e.stopPropagation()
        activeLaneDismissRef.current?.()
        activeLaneDismissRef.current = null
        dismissHighlight()
        const dragId = readHierarchyDragId(e.dataTransfer)
        if (!dragId || dragId === 'root') return
        placeSceneNodeInHierarchy(dragId, parentIdForSiblings, insertBeforeSiblingId)
      }}
    />
  )
})

export function HierarchyPanel() {
  const {
    nodes,
    projectAssets,
    selectionId,
    selectedNodeIds,
    panelFocus,
    hierarchySearch,
    hierarchyCollapsed,
    isolateSubtreeId,
    activeLayerDisplay,
    setSelectionId,
    setSelectedNodeIds,
    setPanelFocus,
    setHierarchySearch,
    toggleHierarchyCollapsed,
    updateNode,
    toggleNodeHierarchyVisible,
    reparentSceneNode,
    placeSceneNodeInHierarchy,
    createEmptyChild,
    duplicateSceneNode,
    expandGltfInterior,
    collapseGltfInterior,
    deleteSceneSubtreesConfirm,
    selectChildrenOf,
    addSceneNodeFromAsset,
    toggleIsolateForSelected,
    clearIsolate,
    setIsolateSubtreeId,
  } = useEditor()

  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [menu, setMenu] = useState<HierarchyMenuState | null>(null)
  const hierarchyPanelRootRef = useRef<HTMLDivElement | null>(null)
  const hierarchyDragSourceHandleRef = useRef<HTMLElement | null>(null)
  const reorderLaneDismissRef = useRef<(() => void) | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const hierarchyTreeScrollRef = useRef<HTMLDivElement | null>(null)
  const hierarchySceneStripRef = useRef<HTMLDivElement | null>(null)
  const hierarchyDropCtxRef = useRef<HierarchyDropActionCtx | null>(null)

  const dismissActiveReorderLane = useCallback(() => {
    reorderLaneDismissRef.current?.()
    reorderLaneDismissRef.current = null
  }, [])

  hierarchyDropCtxRef.current = {
    nodes,
    dismissActiveReorderLane,
    reparentSceneNode,
    addSceneNodeFromAsset,
  }

  const handleHierarchyTreeDropCapture = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const ctx = hierarchyDropCtxRef.current
    if (!ctx) return
    const el = asHTMLElement(e.nativeEvent.target)
    if (!el || isReorderLaneElement(el)) return
    const row = el.closest('[data-hierarchy-row-id]')
    const nId = row?.getAttribute('data-hierarchy-row-id')
    if (!row || !nId) return

    const hid = readHierarchyDragId(e.dataTransfer)
    const aidMime = e.dataTransfer.getData(MIME_ASSET).trim()
    const aidPlainRaw = e.dataTransfer.getData('text/plain').trim()
    const aidPlain =
      aidPlainRaw && !aidPlainRaw.startsWith(HIERARCHY_NODE_PLAINTEXT_PREFIX) ? aidPlainRaw : ''
    const aid = aidMime || aidPlain

    e.preventDefault()
    e.stopPropagation()

    ctx.dismissActiveReorderLane()

    if (hid) {
      const dragId = hid
      if (dragId === nId || dragId === 'root') return
      if (!wouldAncestorBeCycle(ctx.nodes, dragId, nId)) ctx.reparentSceneNode(dragId, nId)
      return
    }
    if (aid) ctx.addSceneNodeFromAsset(aid, { parentId: nId })
  }, [])

  const probeHierarchyReorderTarget = useCallback(
    (e: ReactDragEvent) => {
      const reorderVisual =
        hierarchyPanelRootRef.current?.classList.contains('hierarchyPanelRootDragging') ?? false
      const ty = [...e.dataTransfer.types]
      const hi = isReorderDragEvidence(ty, reorderVisual)
      const as = dragOverLooksLikeAsset(e.dataTransfer)
      if (!hi && !as) return false
      if (hi) dismissActiveReorderLane()
      e.preventDefault()
      e.dataTransfer.dropEffect = hi ? 'move' : 'copy'
      return true
    },
    [dismissActiveReorderLane],
  )

  const clearHierarchyDragVisualState = useCallback(() => {
    hierarchyDragSourceHandleRef.current?.classList.remove('hierarchyDragHandleDragSource')
    hierarchyDragSourceHandleRef.current = null
    hierarchyPanelRootRef.current?.classList.remove('hierarchyPanelRootDragging')
  }, [])

  const order = useMemo(() => siblingOrderIndex(nodes), [nodes])
  const matchIds = useMemo(() => subtreeMatchIds(nodes, hierarchySearch), [nodes, hierarchySearch])
  /** Root / scene graph node — drop target for the Scene chrome strip above the scroll area. */
  const sceneHierarchyRootId = useMemo(() => nodes.find((n) => n.parentId === null)?.id ?? 'root', [nodes])
  const closeMenu = useCallback(() => setMenu(null), [])
  const dropLanesEnabled = hierarchySearch.trim() === ''

  useEffect(() => {
    if (!menu) return
    const onClose = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      closeMenu()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('mousedown', onClose)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('mousedown', onClose)
      window.removeEventListener('keydown', onEsc)
    }
  }, [menu, closeMenu])

  useEffect(() => {
    const onWinDragEnd = () => {
      clearHierarchyDragVisualState()
      reorderLaneDismissRef.current?.()
      reorderLaneDismissRef.current = null
    }
    window.addEventListener('dragend', onWinDragEnd, true)
    return () => window.removeEventListener('dragend', onWinDragEnd, true)
  }, [clearHierarchyDragVisualState])

  /** Window capture: Edge/Chromium often need preventDefault before the real hit-target (nested buttons). */
  useLayoutEffect(() => {
    const openHierarchyPanelDragTargets = (e: globalThis.DragEvent) => {
      const panel = hierarchyPanelRootRef.current
      const raw = e.target
      if (!panel || !(raw instanceof Node) || !panel.contains(raw)) return
      const header = panel.querySelector('.hierarchyPanelTopHeader')
      if (header?.contains(raw)) return

      const dt = e.dataTransfer
      if (!dt) return
      const reorderVisual = panel.classList.contains('hierarchyPanelRootDragging')
      const ty = [...dt.types]
      const hi = isReorderDragEvidence(ty, reorderVisual)
      const as = dragOverLooksLikeAsset(dt)
      if (!hi && !as) return
      if (hi) {
        reorderLaneDismissRef.current?.()
        reorderLaneDismissRef.current = null
      }
      e.preventDefault()
      dt.dropEffect = hi ? 'move' : 'copy'
    }

    window.addEventListener('dragenter', openHierarchyPanelDragTargets, true)
    window.addEventListener('dragover', openHierarchyPanelDragTargets, true)
    return () => {
      window.removeEventListener('dragenter', openHierarchyPanelDragTargets, true)
      window.removeEventListener('dragover', openHierarchyPanelDragTargets, true)
    }
  }, [])

  function renderReorderLane(
    parentIdForSiblings: string,
    insertBeforeSiblingId: string | null,
    laneDepthPx: number,
  ): ReactElement {
    const key = `${parentIdForSiblings}::${insertBeforeSiblingId ?? 'end'}`
    return (
      <HierarchyReorderLane
        key={`hl-${key}`}
        parentIdForSiblings={parentIdForSiblings}
        insertBeforeSiblingId={insertBeforeSiblingId}
        laneDepthPx={laneDepthPx}
        dropLanesEnabled={dropLanesEnabled}
        placeSceneNodeInHierarchy={placeSceneNodeInHierarchy}
        activeLaneDismissRef={reorderLaneDismissRef}
        hierarchyPanelRootRef={hierarchyPanelRootRef}
      />
    )
  }

  function hierarchyRowMarkup(n: EditorNode, depth: number): ReactElement {
    const collapsed = Boolean(hierarchyCollapsed[n.id])
    const hasKidsGraph = nodes.some((x) => x.parentId === n.id)
    const isSel = selectedNodeIds.includes(n.id)
    const px = depth * 14

    return (
      <div
        key={`row:${n.id}`}
        data-hierarchy-row-id={n.id}
        className="hierarchyRowWrap"
        style={{ paddingLeft: px }}
        onDragOverCapture={(e) => {
          probeHierarchyReorderTarget(e)
        }}
        onDragOver={(e) => {
          probeHierarchyReorderTarget(e)
        }}
      >
        {n.id === 'root' ? (
          <div className="hierarchyDragHandleSpacer" aria-hidden />
        ) : (
          <div
            role="presentation"
            className="hierarchyDragHandle"
            draggable
            title="Drag — drop on another row to parent, between rows to reorder"
            onDragStart={(ev) => {
              ev.stopPropagation()
              ev.dataTransfer.setData(MIME_HIERARCHY_NODE, n.id)
              ev.dataTransfer.setData(MIME_HIERARCHY_NODE_ALT, n.id)
              ev.dataTransfer.setData(
                'text/plain',
                `${HIERARCHY_NODE_PLAINTEXT_PREFIX}${n.id}`,
              )
              ev.dataTransfer.effectAllowed = 'copyMove'
              const host = ev.currentTarget as HTMLElement
              hierarchyDragSourceHandleRef.current = host
              host.classList.add('hierarchyDragHandleDragSource')
              hierarchyPanelRootRef.current?.classList.add('hierarchyPanelRootDragging')
            }}
            onDragEnd={() => {
              clearHierarchyDragVisualState()
              dismissActiveReorderLane()
            }}
          >
            ⋮
          </div>
        )}
        <button
          type="button"
          className={`hierarchyCaret${collapsed ? '' : ' hierarchyCaretOpen'}${hasKidsGraph ? '' : ' hierarchyCaretSpacer'}`}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          disabled={!hasKidsGraph}
          onClick={(e) => {
            e.stopPropagation()
            if (!hasKidsGraph) return
            toggleHierarchyCollapsed(n.id)
          }}
        />
        <button
          type="button"
          title={n.visible === false ? 'Hidden in viewport — show' : 'Hide in viewport'}
          className="hierarchyIconBtn hierarchyEyeBtn"
          onClick={(e) => {
            e.stopPropagation()
            toggleNodeHierarchyVisible(n.id)
          }}
        >
          {n.visible === false ? '○' : '●'}
        </button>
        <button
          type="button"
          className={`hierarchyRowBtn${isSel ? ' hierarchyRowSelected' : ''}`}
          role="treeitem"
          onClick={(e) => {
            const mod = e.shiftKey || e.metaKey || e.ctrlKey
            if (mod && n.id !== 'root') {
              setSelectedNodeIds(
                selectedNodeIds.includes(n.id)
                  ? selectedNodeIds.filter((x) => x !== n.id)
                  : [...selectedNodeIds, n.id],
              )
            } else {
              setSelectionId(n.id)
            }
            setPanelFocus('hierarchy')
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setSelectionId(n.id)
            setMenu({ clientX: e.clientX, clientY: e.clientY, nodeId: n.id })
          }}
        >
          {renameId === n.id ? (
            <input
              className="hierarchyRenameInput"
              autoFocus
              value={renameDraft}
              onChange={(ev) => setRenameDraft(ev.target.value)}
              onBlur={() => {
                const t = renameDraft.trim()
                if (t) updateNode(n.id, { name: t })
                setRenameId(null)
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
                if (ev.key === 'Escape') {
                  setRenameId(null)
                  setRenameDraft(n.name)
                }
              }}
              onClick={(ev) => ev.stopPropagation()}
            />
          ) : (
            <span>{n.name}</span>
          )}
        </button>
      </div>
    )
  }

  function renderSubtreeFromParent(parentIdForChildren: string, rowDepthForChildren: number): ReactElement[] {
    const children = sortByDocumentOrder(
      nodes.filter((x) => x.parentId === parentIdForChildren && matchIds.has(x.id)),
      order,
    )
    const out: ReactElement[] = []
    const px = rowDepthForChildren * 14
    children.forEach((c) => {
      if (dropLanesEnabled)
        out.push(renderReorderLane(parentIdForChildren, c.id, px))
      out.push(...expandSubtreeForNode(c, rowDepthForChildren))
    })
    if (dropLanesEnabled && children.length) out.push(renderReorderLane(parentIdForChildren, null, px))
    return out
  }

  function expandSubtreeForNode(n: EditorNode, depth: number): ReactElement[] {
    const collapsed = Boolean(hierarchyCollapsed[n.id])
    const hasKidsGraph = nodes.some((x) => x.parentId === n.id)
    const row = hierarchyRowMarkup(n, depth)
    if (collapsed || !hasKidsGraph) return [row]
    return [row, ...renderSubtreeFromParent(n.id, depth + 1)]
  }

  function renderRootHierarchy(): ReactElement[] {
    const roots = sortByDocumentOrder(
      nodes.filter((x) => x.parentId === null && matchIds.has(x.id)),
      order,
    )
    return roots.flatMap((r) => expandSubtreeForNode(r, 0))
  }

  useEffect(() => {
    if (panelFocus !== 'hierarchy') return
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return

      const primary = selectionId
      const rootId = nodes.find((n) => n.parentId === null)?.id ?? null

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!primary || primary === 'root') return
        deleteSceneSubtreesConfirm(selectedNodeIds.filter((id) => id !== 'root'))
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (primary && primary !== 'root') duplicateSceneNode(primary)
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        toggleIsolateForSelected()
        e.preventDefault()
        return
      }
      if (e.key === 'F2') {
        if (!primary || primary === 'root') return
        const n = nodes.find((x) => x.id === primary)
        if (n) {
          setRenameId(primary)
          setRenameDraft(n.name)
        }
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        clearIsolate()
        if (rootId) setSelectionId(rootId)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    panelFocus,
    selectionId,
    selectedNodeIds,
    nodes,
    deleteSceneSubtreesConfirm,
    duplicateSceneNode,
    toggleIsolateForSelected,
    clearIsolate,
    setSelectionId,
  ])

  return (
    <div
      ref={hierarchyPanelRootRef}
      className="hierarchyPanelRoot"
      onMouseDown={() => setPanelFocus('hierarchy')}
    >
      <div className="divisionHeader hierarchyPanelTopHeader">
        <span className="hierarchyPanelTopTitle">Hierarchy</span>
        <div className="hierarchyPanelTopSearchWrap">
          <input
            className="hierarchySearchInput"
            type="search"
            placeholder="Filter hierarchy…"
            value={hierarchySearch}
            onChange={(ev) => setHierarchySearch(ev.target.value)}
            aria-label="Hierarchy filter"
          />
        </div>
      </div>
      <div
        ref={hierarchySceneStripRef}
        className="hierarchySceneStrip"
        title="Current scene (Sketcher UI_DTM) — drop here to parent under scene root"
        onDragOverCapture={(e) => probeHierarchyReorderTarget(e)}
        onDragOver={(e) => probeHierarchyReorderTarget(e)}
        onDrop={(e) => {
          const rootId = sceneHierarchyRootId
          const hid = readHierarchyDragId(e.dataTransfer)
          const aidMime = e.dataTransfer.getData(MIME_ASSET).trim()
          const aidPlainRaw = e.dataTransfer.getData('text/plain').trim()
          const aidPlain =
            aidPlainRaw && !aidPlainRaw.startsWith(HIERARCHY_NODE_PLAINTEXT_PREFIX)
              ? aidPlainRaw
              : ''
          const aid = aidMime || aidPlain
          e.preventDefault()
          dismissActiveReorderLane()
          if (hid) {
            const dragId = hid
            if (dragId === rootId) return
            if (!wouldAncestorBeCycle(nodes, dragId, rootId)) reparentSceneNode(dragId, rootId)
            return
          }
          if (aid) addSceneNodeFromAsset(aid, { parentId: rootId })
        }}
      >
        <span className="hierarchySceneStripLabel">Scene</span>
        <span className="hierarchyLayerPill">
          {activeLayerDisplay}
          {isolateSubtreeId ? (
            <span className="hierarchyIsolateTag"> Isolate</span>
          ) : null}
        </span>
      </div>
      <div
        ref={hierarchyTreeScrollRef}
        className="hierarchyTreeScroll"
        role="tree"
        onDropCapture={handleHierarchyTreeDropCapture}
        onDragEnd={() => {
          clearHierarchyDragVisualState()
          dismissActiveReorderLane()
        }}
      >
        {renderRootHierarchy()}
      </div>

      {menu ? (
        <div
          ref={menuRef}
          className="contextMenu"
          style={{ left: menu.clientX, top: menu.clientY }}
          role="menu"
        >
          {menu.nodeId !== 'root' ? (
            <button
              type="button"
              className="contextMenuItem"
              role="menuitem"
              onClick={() => {
                const n = nodes.find((x) => x.id === menu.nodeId)
                closeMenu()
                if (n) {
                  setRenameId(menu.nodeId)
                  setRenameDraft(n.name)
                }
              }}
            >
              Rename
            </button>
          ) : null}
          <button
            type="button"
            className="contextMenuItem"
            role="menuitem"
            onClick={() => {
              createEmptyChild(menu.nodeId)
              closeMenu()
            }}
          >
            New empty
          </button>
          <button
            type="button"
            className="contextMenuItem"
            role="menuitem"
            onClick={() => {
              selectChildrenOf(menu.nodeId)
              closeMenu()
            }}
          >
            Select children
          </button>
          <button
            type="button"
            className="contextMenuItem"
            role="menuitem"
            onClick={() => {
              closeMenu()
              setIsolateSubtreeId(isolateSubtreeId === menu.nodeId ? null : menu.nodeId)
            }}
          >
            Isolate / unisolate subtree
          </button>
          {menu.nodeId !== 'root'
            ? (() => {
                const mn = nodes.find((x) => x.id === menu.nodeId)
                const glbAid = mn?.assetRef
                const rel = glbAid ? projectAssets.find((a) => a.assetId === glbAid)?.relativePath ?? '' : ''
                const glbAsset = !!glbAid && rel.toLowerCase().endsWith('.glb')
                const expanded =
                  !!glbAid && !!mn && placementHasExpandedInterior(nodes, menu.nodeId, glbAid)
                const api = isApiConfigured()
                const canExpand = !!(glbAsset && mn && api && glbAid && !expanded)
                const canCollapse = !!(glbAsset && expanded)
                return (
                  <>
                    {canExpand ? (
                      <button
                        type="button"
                        className="contextMenuItem"
                        role="menuitem"
                        onClick={() => {
                          closeMenu()
                          void expandGltfInterior(menu.nodeId)
                        }}
                      >
                        Expand GLB hierarchy…
                      </button>
                    ) : null}
                    {canCollapse ? (
                      <button
                        type="button"
                        className="contextMenuItem"
                        role="menuitem"
                        onClick={() => {
                          collapseGltfInterior(menu.nodeId)
                          closeMenu()
                        }}
                      >
                        Collapse GLB hierarchy
                      </button>
                    ) : null}
                  </>
                )
              })()
            : null}
          {menu.nodeId !== 'root' ? (
            <>
              <button
                type="button"
                className="contextMenuItem"
                role="menuitem"
                onClick={() => {
                  duplicateSceneNode(menu.nodeId)
                  closeMenu()
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="contextMenuItem danger"
                role="menuitem"
                onClick={() => {
                  deleteSceneSubtreesConfirm([menu.nodeId])
                  closeMenu()
                }}
              >
                Delete…
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function wouldAncestorBeCycle(nodes: EditorNode[], nodeId: string, newParentId: string): boolean {
  let cur: string | null = newParentId
  while (cur) {
    if (cur === nodeId) return true
    cur = nodes.find((x) => x.id === cur)?.parentId ?? null
  }
  return false
}
