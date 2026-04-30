import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { useEditor } from './EditorContext'
import type { EditorNode } from './types'

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
}: {
  object: THREE.Object3D
  nodeId: string
  orbitRef: React.MutableRefObject<unknown>
}) {
  const { updateNode } = useEditor()
  const tcRef = useRef<any>(null)

  useEffect(() => {
    const ctrl = tcRef.current as {
      addEventListener?: (ev: string, fn: (e: { value: boolean }) => void) => void
      removeEventListener?: (ev: string, fn: (e: { value: boolean }) => void) => void
    } | null
    if (!ctrl?.addEventListener) return
    const onDrag = (ev: { value: boolean }) => {
      const o = orbitRef.current as { enabled: boolean } | null
      if (o) o.enabled = !ev.value
    }
    ctrl.addEventListener('dragging-changed', onDrag)
    return () => ctrl.removeEventListener?.('dragging-changed', onDrag)
  }, [orbitRef, object])

  return (
    <TransformControls
      ref={tcRef}
      object={object}
      mode="translate"
      onObjectChange={() => {
        updateNode(nodeId, {
          position: object.position.toArray() as EditorNode['position'],
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
          scale: object.scale.toArray() as EditorNode['scale'],
        })
      }}
    />
  )
}

function SceneGroup({
  node,
  children,
  orbitRef,
}: {
  node: EditorNode
  children?: ReactNode
  orbitRef: React.MutableRefObject<unknown>
}) {
  const { selectionId, setSelectionId, setPanelFocus, resolveGltfUrl } = useEditor()
  const isSelected = selectionId === node.id
  const [grp, setGrp] = useState<THREE.Group | null>(null)
  const gltfUrl = node.gltfDataUrl ?? resolveGltfUrl(node) ?? null

  return (
    <>
      <group
        ref={setGrp}
        position={node.position}
        rotation={node.rotation as [number, number, number]}
        scale={node.scale}
        onClick={(e) => {
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
      {grp && isSelected ? <AttachTransformControls object={grp} nodeId={node.id} orbitRef={orbitRef} /> : null}
    </>
  )
}

function NodeRecursive({
  id,
  orbitRef,
}: {
  id: string
  orbitRef: React.MutableRefObject<unknown>
}) {
  const { nodes } = useEditor()
  const node = nodes.find((n) => n.id === id)
  if (!node) return null
  const childIds = nodes.filter((c) => c.parentId === id).map((c) => c.id)
  return (
    <SceneGroup node={node} orbitRef={orbitRef}>
      {childIds.map((cid) => (
        <NodeRecursive key={cid} id={cid} orbitRef={orbitRef} />
      ))}
    </SceneGroup>
  )
}

function ViewportScene() {
  const { nodes } = useEditor()
  const orbitRef = useRef<unknown>(null)
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
        <NodeRecursive key={rid} id={rid} orbitRef={orbitRef} />
      ))}
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
      </Suspense>
    </Canvas>
  )
}

export function PreviewViewport() {
  const { setViewportHover } = useEditor()

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
