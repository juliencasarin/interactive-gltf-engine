import { Canvas, events as r3fEvents, useThree, type RootStore, type ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import * as THREE from 'three'
import { fetchAssetSource, isApiConfigured } from '@/api/projectApi'
import { bindIgltfNodeIndices } from '@/play/bindIgltfNodeIndices'
import type { GltfJson } from '@/play/umi3dProtoTypes'
import {
  createStubInteractiveGltfHost,
  loadClassicScriptIntoRegistry,
  loadModuleScriptIntoRegistry,
  type HandlerRegistry,
} from '@/scriptRuntime/loader'
import { isGltfAssetEntry, isScriptAssetEntry } from './assetUtils'
import { MIME_ASSET, dragOverLooksLikeAsset } from './dndTypes'
import { useEditor } from './EditorContext'
import {
  buildInteriorPickCache,
  editorInteriorVisibilityEffective,
  type InteriorPickCache,
  listInteriorMirrorsHostedBy,
  placementHasExpandedInterior,
  resolveInteriorDuplicateAnchorMirrorId,
  resolveInteriorHostPlacementId,
} from './interiorPlacementContext'
import { accelerateGltfSceneRaycasts, disableObjectRaycast } from './gltfRaycastAcceleration'
import { localTRSFromObjectMatrices, mirrorDeltaFromObject, type TransformSpace } from './transformMath'
import type { EditorNode, ProjectAssetEntry } from './types'

const _evWork = new THREE.Euler(0, 0, 0, 'XYZ')
const _qWork = new THREE.Quaternion()
const _vWork = new THREE.Vector3()

type InteriorBaselineSnapshot = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

type GltfInteriorThreeRefs = {
  placementId: string
  catalogAssetId: string
  objectsByIndex: MutableRefObject<Map<number, THREE.Object3D>>
  baselinesByIndex: MutableRefObject<Map<number, InteriorBaselineSnapshot>>
  /** Resolved transform roots for each interior mirror editor row (incl. duplicate instances). */
  objectsByEditorId: MutableRefObject<Map<string, THREE.Object3D>>
}

type PlacementInteriorPickState = {
  catalogAssetId: string
  pickCache: InteriorPickCache
  objectsByEditorId: ReadonlyMap<string, THREE.Object3D>
}

/** Updated when expanded-interior Three bindings rebuild (per catalogue placement). */
const placementInteriorPickByPlacementId = new Map<string, PlacementInteriorPickState>()

function pickDeepestMirrorRowId(
  candidateIds: readonly string[],
  pickCache: InteriorPickCache,
  docIx: Map<string, number>,
): string | null {
  let best: string | null = null
  let bestDepth = -1
  let bestDoc = -1
  for (const id of candidateIds) {
    const depth = pickCache.depthByRowId.get(id) ?? 0
    const doc = docIx.get(id) ?? Number.MAX_SAFE_INTEGER
    if (depth > bestDepth || (depth === bestDepth && doc > bestDoc)) {
      best = id
      bestDepth = depth
      bestDoc = doc
    }
  }
  return best
}

function threeObjectOnAncestorChain(hit: THREE.Object3D, root: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = hit
  while (cur) {
    if (cur === root) return true
    cur = cur.parent as THREE.Object3D | null
  }
  return false
}

function mirrorEditorRowIdFromInteriorHit(
  nodesById: Map<string, EditorNode>,
  docIx: Map<string, number>,
  placementId: string,
  pickState: PlacementInteriorPickState,
  hit: THREE.Object3D,
): string {
  const { pickCache, objectsByEditorId } = pickState
  const editorIdsOnPath: string[] = []
  let cur: THREE.Object3D | null = hit
  while (cur) {
    const eid = cur.userData?.igltfEditorNodeId
    if (typeof eid === 'string' && eid.length > 0 && nodesById.has(eid)) editorIdsOnPath.push(eid)
    cur = cur.parent as THREE.Object3D | null
  }
  const deepestEditor = pickDeepestMirrorRowId(editorIdsOnPath, pickCache, docIx)
  if (deepestEditor) return deepestEditor

  cur = hit
  while (cur) {
    const gi = cur.userData?.igltfNodeIndex
    if (typeof gi === 'number') {
      const cands = (pickCache.rowsByGltfIndex.get(gi) ?? []).filter((id) => {
        const mapped = objectsByEditorId.get(id)
        return mapped ? threeObjectOnAncestorChain(hit, mapped) : false
      })
      return pickDeepestMirrorRowId(cands, pickCache, docIx) ?? placementId
    }
    cur = cur.parent as THREE.Object3D | null
  }
  return placementId
}

function findCataloguePlacementIdFromHit(hit: THREE.Object3D): string | null {
  let cur: THREE.Object3D | null = hit
  while (cur) {
    const pid = cur.userData?.igltfPlacementId
    if (typeof pid === 'string' && pid.length > 0) return pid
    cur = cur.parent as THREE.Object3D | null
  }
  return null
}

function resolveViewportPickId(
  nodes: EditorNode[],
  nodesById: Map<string, EditorNode>,
  docIx: Map<string, number>,
  hit: THREE.Object3D,
): string | null {
  const placementId = findCataloguePlacementIdFromHit(hit)
  if (!placementId) return null
  const placement = nodesById.get(placementId)
  const cat = placement?.assetRef
  if (!cat || !placementHasExpandedInterior(nodes, placementId, cat)) return placementId
  const pickState = placementInteriorPickByPlacementId.get(placementId)
  if (!pickState || pickState.catalogAssetId !== cat) return placementId
  return mirrorEditorRowIdFromInteriorHit(nodesById, docIx, placementId, pickState, hit)
}

function findInteriorObjectByGltfIndex(root: THREE.Object3D, gltfIndex: number): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((o) => {
    if (found) return
    if (o.userData?.igltfNodeIndex === gltfIndex) found = o
  })
  return found
}

/** Drop glTF index tags on a preview duplicate branch (canonical templates keep indices for binding). */
function stripIgltfIndexOnPreviewDuplicateBranch(dupRoot: THREE.Object3D): void {
  dupRoot.traverse((o) => {
    delete o.userData.igltfNodeIndex
  })
}

function removeInteriorPreviewDuplicates(template: THREE.Object3D | undefined, ix: number): void {
  if (!template?.parent) return
  const p = template.parent
  const doomed: THREE.Object3D[] = []
  for (const ch of [...p.children]) {
    const o = ch as THREE.Object3D
    if (
      o !== template &&
      o.userData?.igltfPreviewDuplicate &&
      o.userData?.igltfDupSourceIndex === ix
    ) {
      doomed.push(o)
    }
  }
  for (const o of doomed) p.remove(o)
}

/**
 * Remove every interior preview clone rooted in this scene subtree.
 * Needed because sibling-only cleanup keyed by `(template.parent, ix)` misses orphans when the shared
 * parent chain changes between rebuilds / React StrictMode remounts, which stacks duplicate meshes.
 */
function stripAllIgltfPreviewDuplicatesUnder(sceneRoot: THREE.Object3D): void {
  const doomed: THREE.Object3D[] = []
  sceneRoot.traverse((o) => {
    if (o.userData?.igltfPreviewDuplicate === true) doomed.push(o)
  })
  for (const o of doomed) {
    if (o.parent) o.parent.remove(o)
  }
}

function rebuildInteriorInstanceObjects(
  nodes: EditorNode[],
  interior: GltfInteriorThreeRefs,
  expanded: boolean,
  sceneRoot: THREE.Object3D,
): void {
  const { placementId, catalogAssetId, objectsByIndex, baselinesByIndex, objectsByEditorId } = interior

  stripAllIgltfPreviewDuplicatesUnder(sceneRoot)
  objectsByEditorId.current.clear()

  for (const [ix, template] of objectsByIndex.current) {
    removeInteriorPreviewDuplicates(template, ix)
    delete template.userData.igltfEditorNodeId
    const b = baselinesByIndex.current.get(ix)
    if (b) {
      template.position.copy(b.position)
      template.quaternion.copy(b.quaternion)
      template.scale.copy(b.scale)
      template.visible = true
    }
  }

  if (!expanded) {
    placementInteriorPickByPlacementId.delete(placementId)
    return
  }

  const rows = listInteriorMirrorsHostedBy(nodes, placementId, catalogAssetId)
  const firstAtIndex = new Map<number, string>()
  for (const row of rows) {
    const ix = row.sourceGltfNodeIndex!
    if (!firstAtIndex.has(ix)) firstAtIndex.set(ix, row.id)
  }

  const nestedPending: { row: EditorNode; anchorId: string }[] = []

  for (const row of rows) {
    const ix = row.sourceGltfNodeIndex!
    const template = objectsByIndex.current.get(ix) as THREE.Object3D | undefined
    if (!template?.parent) continue

    const canonicalId = firstAtIndex.get(ix)!
    if (row.id === canonicalId) {
      template.userData.igltfEditorNodeId = row.id
      objectsByEditorId.current.set(row.id, template)
      continue
    }

    const anchorId = resolveInteriorDuplicateAnchorMirrorId(
      nodes,
      placementId,
      catalogAssetId,
      row.id,
    )
    if (anchorId) {
      nestedPending.push({ row, anchorId })
      continue
    }

    const dup = template.clone(true)
    dup.userData.igltfPreviewDuplicate = true
    dup.userData.igltfDupSourceIndex = ix
    dup.userData.igltfEditorNodeId = row.id
    template.parent!.add(dup)
    objectsByEditorId.current.set(row.id, dup)
  }

  for (const { row, anchorId } of nestedPending) {
    const anchorObj = objectsByEditorId.current.get(anchorId)
    if (!anchorObj) continue
    const ix = row.sourceGltfNodeIndex!
    const inner = findInteriorObjectByGltfIndex(anchorObj, ix)
    if (!inner) continue
    inner.userData.igltfEditorNodeId = row.id
    objectsByEditorId.current.set(row.id, inner)
  }

  for (const [, obj] of objectsByEditorId.current) {
    if (obj.userData.igltfPreviewDuplicate === true) {
      stripIgltfIndexOnPreviewDuplicateBranch(obj)
    }
  }

  placementInteriorPickByPlacementId.set(placementId, {
    catalogAssetId,
    pickCache: buildInteriorPickCache(nodes, placementId, catalogAssetId),
    objectsByEditorId: objectsByEditorId.current,
  })
}

function syncExpandedInteriorToThree(
  nodes: EditorNode[],
  interior: GltfInteriorThreeRefs,
  expanded: boolean,
): void {
  const { catalogAssetId, baselinesByIndex, objectsByEditorId } = interior

  for (const [editorId, obj] of objectsByEditorId.current) {
    const row = nodes.find((n) => n.id === editorId)
    if (!row || row.sourceGltfNodeIndex === undefined || row.sourceAssetRef !== catalogAssetId) continue
    const ix = row.sourceGltfNodeIndex
    const b = baselinesByIndex.current.get(ix)
    if (!b) continue

    if (!expanded) {
      obj.position.copy(b.position)
      obj.quaternion.copy(b.quaternion)
      obj.scale.copy(b.scale)
      obj.visible = true
      continue
    }

    const chainOk = editorInteriorVisibilityEffective(nodes, row)
    obj.visible = chainOk
    if (!chainOk) continue

    obj.position.copy(b.position).add(_vWork.fromArray(row.position))
    _qWork.setFromEuler(_evWork.set(row.rotation[0], row.rotation[1], row.rotation[2], 'XYZ'))
    obj.quaternion.copy(b.quaternion).multiply(_qWork)
    obj.scale.set(b.scale.x * row.scale[0], b.scale.y * row.scale[1], b.scale.z * row.scale[2])
  }
}

function isolateAllowSet(nodes: EditorNode[], isolateRoot: string | null): Set<string> | null {
  if (!isolateRoot) return null
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const allow = new Set<string>()
  let cur: string | null = isolateRoot
  while (cur) {
    allow.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  const walk = (id: string) => {
    allow.add(id)
    for (const c of nodes.filter((x) => x.parentId === id)) walk(c.id)
  }
  walk(isolateRoot)
  return allow
}

function CanvasViewportRaycastDrop() {
  const { camera, gl } = useThree()
  const { addSceneNodeFromAsset, projectAssets } = useEditor()

  useEffect(() => {
    const canvas = gl.domElement

    const onDragOverCanvas = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt) return
      if (dragOverLooksLikeAsset(dt)) {
        e.preventDefault()
        e.stopPropagation()
        dt.dropEffect = 'copy'
      }
    }

    const onDropCanvas = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt) return
      const raw = dt.getData(MIME_ASSET) || dt.getData('text/plain')
      const assetId = raw.trim()
      if (!assetId) return
      const entry = projectAssets.find((a) => a.assetId === assetId)
      if (!entry || !isGltfAssetEntry(entry)) return
      e.preventDefault()
      e.stopPropagation()

      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera as THREE.Camera)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const hit = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(plane, hit)) {
        addSceneNodeFromAsset(assetId, { worldPosition: [hit.x, hit.y, hit.z] })
      } else {
        addSceneNodeFromAsset(assetId)
      }
    }

    canvas.addEventListener('dragover', onDragOverCanvas)
    canvas.addEventListener('drop', onDropCanvas)
    return () => {
      canvas.removeEventListener('dragover', onDragOverCanvas)
      canvas.removeEventListener('drop', onDropCanvas)
    }
  }, [camera, gl, addSceneNodeFromAsset, projectAssets])
  return null
}

function usePreviewScriptRegistry(
  projectId: string,
  projectAssets: ProjectAssetEntry[],
  assetFetchRev: number,
): MutableRefObject<HandlerRegistry> {
  const registryRef = useRef<HandlerRegistry>({})
  useEffect(() => {
    let cancelled = false
    const host = createStubInteractiveGltfHost()
    const reg: HandlerRegistry = {}
    void (async () => {
      const scripts = projectAssets.filter(isScriptAssetEntry)
      for (const a of scripts) {
        let src = a.sourceText
        if (src === undefined && isApiConfigured()) {
          try {
            src = await fetchAssetSource(projectId, a.assetId)
          } catch {
            continue
          }
        }
        if (!src || cancelled) continue
        const lower = a.relativePath.toLowerCase()
        try {
          if (lower.endsWith('.cjs') && a.scriptExports?.length) {
            loadClassicScriptIntoRegistry(src, host, reg, a.scriptExports)
          } else {
            await loadModuleScriptIntoRegistry(src, a.assetId, host, reg, {
              interactionKind: a.interactionKind,
            })
          }
        } catch (err) {
          console.warn('[igltf preview] script load failed', a.assetId, err)
        }
      }
      if (!cancelled) {
        registryRef.current = reg
        console.info('[igltf preview] script handlers', Object.keys(reg))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, projectAssets, assetFetchRev])
  return registryRef
}

function GltfContent({ url, interior }: { url: string; interior: GltfInteriorThreeRefs | null }) {
  const gltf = useGLTF(url)
  const clone = useMemo(() => gltf.scene.clone(true), [gltf.scene, url])
  const parserJson = (gltf as { parser: { json: GltfJson } }).parser.json
  const { nodes } = useEditor()

  useLayoutEffect(() => {
    bindIgltfNodeIndices(clone, parserJson)
    if (interior) clone.userData.igltfPlacementId = interior.placementId
    accelerateGltfSceneRaycasts(clone)
    if (!interior) return
    interior.objectsByIndex.current.clear()
    interior.baselinesByIndex.current.clear()
    interior.objectsByEditorId.current.clear()
    clone.traverse((obj) => {
      const ix = obj.userData?.igltfNodeIndex
      if (typeof ix !== 'number') return
      const o = obj as THREE.Object3D
      interior.objectsByIndex.current.set(ix, o)
      interior.baselinesByIndex.current.set(ix, {
        position: o.position.clone(),
        quaternion: o.quaternion.clone(),
        scale: o.scale.clone(),
      })
    })
  }, [clone, parserJson, interior])

  useLayoutEffect(() => {
    if (!interior) return
    const expanded = placementHasExpandedInterior(nodes, interior.placementId, interior.catalogAssetId)
    rebuildInteriorInstanceObjects(nodes, interior, expanded, clone)
    syncExpandedInteriorToThree(nodes, interior, expanded)
    return () => {
      stripAllIgltfPreviewDuplicatesUnder(clone)
    }
  }, [clone, nodes, interior])

  useEffect(() => {
    if (interior) return undefined
    return () => {
      clone.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry?.dispose()
          const m = o.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m?.dispose()
        }
      })
    }
  }, [clone, interior])
  return <primitive object={clone} />
}

function AttachTransformControls({
  object,
  nodeId,
  orbitRef,
  mode,
  space,
  onDragChange,
}: {
  object: THREE.Object3D
  nodeId: string
  orbitRef: MutableRefObject<unknown>
  mode: 'translate' | 'rotate' | 'scale'
  space: TransformSpace
  onDragChange: (dragging: boolean) => void
}) {
  const { updateNode } = useEditor()
  const tcRef = useRef<unknown>(null)

  useEffect(() => {
    const ctrl = tcRef.current as {
      addEventListener?: (ev: string, fn: (e: { value: boolean }) => void) => void
      removeEventListener?: (ev: string, fn: (e: { value: boolean }) => void) => void
    } | null
    if (!ctrl?.addEventListener) return
    const onDrag = (ev: { value: boolean }) => {
      const o = orbitRef.current as { enabled: boolean } | null
      if (o) o.enabled = !ev.value
      onDragChange(ev.value)
    }
    ctrl.addEventListener('dragging-changed', onDrag)
    return () => ctrl.removeEventListener?.('dragging-changed', onDrag)
  }, [orbitRef, object, onDragChange])

  return (
    <>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <TransformControls
        key={`${nodeId}-${mode}-${space}`}
        ref={tcRef as any}
        object={object}
        mode={mode}
        space={space}
        translationSnap={0.1}
        rotationSnap={THREE.MathUtils.degToRad(15)}
        onObjectChange={() => {
          const parentObj = object.parent
          const trs =
            space === 'world' && parentObj
              ? localTRSFromObjectMatrices(object, parentObj)
              : {
                  position: object.position.toArray() as EditorNode['position'],
                  rotation: [object.rotation.x, object.rotation.y, object.rotation.z] as EditorNode['rotation'],
                  scale: object.scale.toArray() as EditorNode['scale'],
                }
          updateNode(nodeId, trs)
        }}
      />
    </>
  )
}

function MirrorInteriorTransformControls({
  object,
  nodeId,
  baseline,
  orbitRef,
  mode,
  space,
  onDragChange,
}: {
  object: THREE.Object3D
  nodeId: string
  baseline: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }
  orbitRef: MutableRefObject<unknown>
  mode: 'translate' | 'rotate' | 'scale'
  space: TransformSpace
  onDragChange: (dragging: boolean) => void
}) {
  const { updateNode } = useEditor()
  const tcRef = useRef<unknown>(null)

  useEffect(() => {
    const ctrl = tcRef.current as {
      addEventListener?: (ev: string, fn: (e: { value: boolean }) => void) => void
      removeEventListener?: (ev: string, fn: (e: { value: boolean }) => void) => void
    } | null
    if (!ctrl?.addEventListener) return
    const onDrag = (ev: { value: boolean }) => {
      const o = orbitRef.current as { enabled: boolean } | null
      if (o) o.enabled = !ev.value
      onDragChange(ev.value)
    }
    ctrl.addEventListener('dragging-changed', onDrag)
    return () => ctrl.removeEventListener?.('dragging-changed', onDrag)
  }, [orbitRef, object, onDragChange])

  return (
    <>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <TransformControls
        key={`mirror-int-${nodeId}-${mode}-${space}`}
        ref={tcRef as any}
        object={object}
        mode={mode}
        space={space}
        translationSnap={0.1}
        rotationSnap={THREE.MathUtils.degToRad(15)}
        onObjectChange={() => {
          const delta = mirrorDeltaFromObject(object, baseline)
          updateNode(nodeId, delta)
        }}
      />
    </>
  )
}

function SceneGroup({
  node,
  children,
  orbitRef,
  isolateSubset,
}: {
  node: EditorNode
  children?: ReactNode
  orbitRef: React.MutableRefObject<unknown>
  isolateSubset: Set<string> | null
}) {
  const {
    nodes,
    selectionId,
    resolveGltfUrl,
    viewportToolMode,
    viewportTransformSpace,
    setViewportTransformDragging,
  } = useEditor()
  const [grp, setGrp] = useState<THREE.Group | null>(null)
  const gltfUrl = node.gltfDataUrl ?? resolveGltfUrl(node) ?? null

  const showGizmo = viewportToolMode !== 'select' && node.id !== 'root'
  const tcMode: 'translate' | 'rotate' | 'scale' =
    viewportToolMode === 'rotate' ? 'rotate' : viewportToolMode === 'scale' ? 'scale' : 'translate'

  const grpVisible =
    isolateSubset === null
      ? node.visible !== false
      : isolateSubset.has(node.id) && node.visible !== false

  const [mirrorTcAttach, setMirrorTcAttach] = useState<THREE.Object3D | null>(null)

  const gltfObjsByIdxRef = useRef(new Map<number, THREE.Object3D>())
  const gltfBaselineRef = useRef(new Map<number, InteriorBaselineSnapshot>())
  const gltfEditorObjByIdRef = useRef(new Map<string, THREE.Object3D>())

  const interiorThreeSync = useMemo((): GltfInteriorThreeRefs | null => {
    if (!node.assetRef) return null
    return {
      placementId: node.id,
      catalogAssetId: node.assetRef,
      objectsByIndex: gltfObjsByIdxRef,
      baselinesByIndex: gltfBaselineRef,
      objectsByEditorId: gltfEditorObjByIdRef,
    }
  }, [node.id, node.assetRef])

  const expandedInterior =
    Boolean(node.assetRef) && placementHasExpandedInterior(nodes, node.id, node.assetRef ?? '')

  const isInteriorMirrorExpandedHostTracked =
    node.sourceAssetRef !== undefined &&
    typeof node.sourceGltfNodeIndex === 'number' &&
    (() => {
      const hid = resolveInteriorHostPlacementId(nodes, node)
      if (!hid) return false
      const hp = nodes.find((x) => x.id === hid)
      return Boolean(hp?.assetRef && placementHasExpandedInterior(nodes, hid, hp.assetRef))
    })()

  const selectedInteriorMirror =
    expandedInterior && selectionId !== node.id
      ? nodes.find(
          (n) =>
            n.id === selectionId &&
            n.sourceAssetRef === node.assetRef &&
            typeof n.sourceGltfNodeIndex === 'number' &&
            resolveInteriorHostPlacementId(nodes, n) === node.id,
        )
      : undefined

  const interiorPickIdx = selectedInteriorMirror?.sourceGltfNodeIndex
  const interiorBaseline =
    typeof interiorPickIdx === 'number' ? gltfBaselineRef.current.get(interiorPickIdx) ?? null : null

  useLayoutEffect(() => {
    if (!selectedInteriorMirror || !expandedInterior) {
      setMirrorTcAttach(null)
      return
    }
    const o = gltfEditorObjByIdRef.current.get(selectedInteriorMirror.id)
    if (o && o.parent !== null) {
      setMirrorTcAttach((prev) => (prev === o ? prev : o))
    } else {
      setMirrorTcAttach(null)
    }
  }, [expandedInterior, nodes, selectionId, selectedInteriorMirror?.id])

  const interiorMirrorSelectable =
    selectedInteriorMirror !== undefined && editorInteriorVisibilityEffective(nodes, selectedInteriorMirror)

  const showPlacementGizmo =
    selectionId === node.id &&
    grp &&
    grpVisible &&
    showGizmo &&
    !isInteriorMirrorExpandedHostTracked

  const showInteriorGizmo =
    mirrorTcAttach !== null &&
    interiorBaseline !== null &&
    interiorMirrorSelectable &&
    grpVisible &&
    showGizmo &&
    selectedInteriorMirror !== undefined

  return (
    <>
      <group
        ref={setGrp}
        visible={grpVisible}
        position={node.position}
        rotation={node.rotation as [number, number, number]}
        scale={node.scale}
      >
        {gltfUrl ? (
          <Suspense fallback={null}>
            <GltfContent url={gltfUrl} interior={interiorThreeSync} />
          </Suspense>
        ) : null}
        {children}
      </group>
      {showPlacementGizmo ? (
        <AttachTransformControls
          object={grp}
          nodeId={node.id}
          orbitRef={orbitRef}
          mode={tcMode}
          space={viewportTransformSpace}
          onDragChange={setViewportTransformDragging}
        />
      ) : null}
      {showInteriorGizmo && interiorBaseline && mirrorTcAttach && selectedInteriorMirror ? (
        <MirrorInteriorTransformControls
          key={`mirror-tc-${selectedInteriorMirror.id}-${mirrorTcAttach.uuid}`}
          object={mirrorTcAttach}
          nodeId={selectedInteriorMirror.id}
          baseline={interiorBaseline}
          orbitRef={orbitRef}
          mode={tcMode}
          space={viewportTransformSpace}
          onDragChange={setViewportTransformDragging}
        />
      ) : null}
    </>
  )
}

function NodeRecursive({
  id,
  orbitRef,
  isolateSubset,
}: {
  id: string
  orbitRef: React.MutableRefObject<unknown>
  isolateSubset: Set<string> | null
}) {
  const { nodes } = useEditor()
  const node = nodes.find((n) => n.id === id)
  if (!node) return null
  const childIds = nodes.filter((c) => c.parentId === id).map((c) => c.id)
  return (
    <SceneGroup node={node} orbitRef={orbitRef} isolateSubset={isolateSubset}>
      {childIds.map((cid) => (
        <NodeRecursive key={cid} id={cid} orbitRef={orbitRef} isolateSubset={isolateSubset} />
      ))}
    </SceneGroup>
  )
}

function ViewportGrid() {
  const rootRef = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.traverse((o) => disableObjectRaycast(o))
  }, [])
  return (
    <group ref={rootRef}>
      <Grid
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.6}
        sectionSize={5}
        sectionColor="#6f6f70"
        cellColor="#565657"
        fadeDistance={28}
        fadeStrength={1.2}
        followCamera={false}
        infiniteGrid
        frustumCulled
      />
    </group>
  )
}

function ViewportScene() {
  const { nodes, isolateSubtreeId, setSelectionId, setPanelFocus } = useEditor()
  const orbitRef = useRef<unknown>(null)
  const isolateSubset = useMemo(
    () => isolateAllowSet(nodes, isolateSubtreeId),
    [nodes, isolateSubtreeId],
  )
  const roots = nodes.filter((n) => n.parentId === null).map((n) => n.id)
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const docOrderIx = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes])

  return (
    <>
      <color attach="background" args={['#4b4b4c']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 5]} intensity={0.95} />
      <ViewportGrid />
      <group
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          const pickId = resolveViewportPickId(nodes, nodesById, docOrderIx, e.object)
          if (!pickId) return
          setSelectionId(pickId)
          setPanelFocus('viewport')
        }}
      >
        {roots.map((rid) => (
          <NodeRecursive key={rid} id={rid} orbitRef={orbitRef} isolateSubset={isolateSubset} />
        ))}
      </group>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <OrbitControls ref={orbitRef as any} makeDefault enableDamping dampingFactor={0.08} />
    </>
  )
}

function editorViewportEvents(store: RootStore) {
  const manager = r3fEvents(store)
  return {
    ...manager,
    filter: (items: THREE.Intersection[]) => (items.length > 1 ? [items[0]!] : items),
  }
}

function EditorCanvas() {
  const { setSelectionId } = useEditor()
  return (
    <Canvas
      camera={{ position: [3.2, 2.4, 3.2], fov: 50, near: 0.05, far: 200 }}
      gl={{ antialias: true, alpha: false }}
      events={editorViewportEvents}
      raycaster={{ firstHitOnly: true }}
      onPointerMissed={(e) => {
        if (e.button === 0) setSelectionId(null)
      }}
    >
      <Suspense fallback={null}>
        <ViewportScene />
        <CanvasViewportRaycastDrop />
      </Suspense>
    </Canvas>
  )
}

export function PreviewViewport() {
  const { setViewportHover, projectId, projectAssets, assetFetchRev } = useEditor()
  usePreviewScriptRegistry(projectId, projectAssets, assetFetchRev)

  return (
    <div
      className="previewViewport previewViewportCanvasHost"
      onPointerEnter={() => setViewportHover(true)}
      onPointerLeave={() => setViewportHover(false)}
    >
      <EditorCanvas />
    </div>
  )
}
