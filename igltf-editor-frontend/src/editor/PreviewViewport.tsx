import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import { fetchAssetSource, isApiConfigured } from '@/api/projectApi'
import {
  createStubInteractiveGltfHost,
  loadClassicScriptIntoRegistry,
  loadModuleScriptIntoRegistry,
  type HandlerRegistry,
} from '@/scriptRuntime/loader'
import { isGltfAssetEntry, isScriptAssetEntry } from './assetUtils'
import { MIME_ASSET, dragOverLooksLikeAsset } from './dndTypes'
import { useEditor } from './EditorContext'
import type { EditorNode, ProjectAssetEntry } from './types'

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

function GltfContent({ url }: { url: string }) {
  const gltf = useGLTF(url)
  const clone = useMemo(() => gltf.scene.clone(true), [gltf.scene, url])
  useEffect(() => {
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
  }, [clone])
  return <primitive object={clone} />
}

function AttachTransformControls({
  object,
  nodeId,
  orbitRef,
  mode,
  onDragChange,
}: {
  object: THREE.Object3D
  nodeId: string
  orbitRef: React.MutableRefObject<unknown>
  mode: 'translate' | 'rotate' | 'scale'
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
        key={`${nodeId}-${mode}`}
        ref={tcRef as any}
        object={object}
        mode={mode}
        onObjectChange={() => {
          updateNode(nodeId, {
            position: object.position.toArray() as EditorNode['position'],
            rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
            scale: object.scale.toArray() as EditorNode['scale'],
          })
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
  const { selectionId, setSelectionId, setPanelFocus, resolveGltfUrl, viewportToolMode, setViewportTransformDragging } =
    useEditor()
  const isSelected = selectionId === node.id
  const [grp, setGrp] = useState<THREE.Group | null>(null)
  const gltfUrl = node.gltfDataUrl ?? resolveGltfUrl(node) ?? null

  const showGizmo = viewportToolMode !== 'select' && node.id !== 'root'
  const tcMode: 'translate' | 'rotate' | 'scale' =
    viewportToolMode === 'rotate' ? 'rotate' : viewportToolMode === 'scale' ? 'scale' : 'translate'

  const grpVisible =
    isolateSubset === null
      ? node.visible !== false
      : isolateSubset.has(node.id) && node.visible !== false

  return (
    <>
      <group
        ref={setGrp}
        visible={grpVisible}
        position={node.position}
        rotation={node.rotation as [number, number, number]}
        scale={node.scale}
        onClick={(e) => {
          if (!grpVisible) return
          e.stopPropagation()
          setSelectionId(node.id)
          setPanelFocus('viewport')
        }}
      >
        {gltfUrl ? (
          <Suspense fallback={null}>
            <GltfContent url={gltfUrl} />
          </Suspense>
        ) : null}
        {children}
      </group>
      {grp && isSelected && grpVisible && showGizmo ? (
        <AttachTransformControls
          object={grp}
          nodeId={node.id}
          orbitRef={orbitRef}
          mode={tcMode}
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

function ViewportScene() {
  const { nodes, isolateSubtreeId } = useEditor()
  const orbitRef = useRef<unknown>(null)
  const isolateSubset = useMemo(
    () => isolateAllowSet(nodes, isolateSubtreeId),
    [nodes, isolateSubtreeId],
  )
  const roots = nodes.filter((n) => n.parentId === null).map((n) => n.id)

  return (
    <>
      <color attach="background" args={['#4b4b4c']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 5]} intensity={0.95} />
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
      {roots.map((rid) => (
        <NodeRecursive key={rid} id={rid} orbitRef={orbitRef} isolateSubset={isolateSubset} />
      ))}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <OrbitControls ref={orbitRef as any} makeDefault enableDamping dampingFactor={0.08} />
    </>
  )
}

function EditorCanvas() {
  const { setSelectionId } = useEditor()
  return (
    <Canvas
      camera={{ position: [3.2, 2.4, 3.2], fov: 50, near: 0.05, far: 200 }}
      gl={{ antialias: true, alpha: false }}
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
