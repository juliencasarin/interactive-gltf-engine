import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { fetchPlayManifest, getApiBase, type PlayManifest } from '@/api/projectApi'
import type { PlayRuntimeMetrics } from '@/play/PlayMetricsCollector'
import { PlayInteractiveGltf } from '@/play/PlayInteractiveGltf'
import { PlayMetricsFooter } from '@/play/PlayMetricsFooter'
import './play-page.css'

function PlayViewport({
  manifest,
  projectId,
  onMetricsUpdate,
}: {
  manifest: PlayManifest
  projectId: string
  onMetricsUpdate: (metrics: PlayRuntimeMetrics) => void
}) {
  return (
    <Canvas
      className="playCanvas"
      camera={{ position: [3.2, 2.4, 3.2], fov: 50, near: 0.05, far: 500 }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={['#4b4b4c']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 5]} intensity={0.95} />
      <Suspense fallback={null}>
        <PlayInteractiveGltf
          key={`${manifest.glbUrl}\0${manifest.jsUrl ?? ''}`}
          glbUrl={manifest.glbUrl}
          projectId={projectId}
          bundledScriptUrl={manifest.jsUrl}
          onMetricsUpdate={onMetricsUpdate}
        />
      </Suspense>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  )
}

export function PlayPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) {
    return <Navigate to="/" replace />
  }
  const projectId = id
  const [manifest, setManifest] = useState<PlayManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<PlayRuntimeMetrics | null>(null)

  useEffect(() => {
    let cancelled = false
    setManifest(null)
    setError(null)
    setMetrics(null)
    if (getApiBase() === '') {
      setError('VITE_API_BASE_URL is not set — cannot load the play manifest.')
      return () => {
        cancelled = true
      }
    }
    void (async () => {
      try {
        const m = await fetchPlayManifest(projectId)
        if (!cancelled) setManifest(m)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return (
    <div className="playPage">
      <header className="playToolbar">
        <Link className="playBackLink" to="/">
          ← Projects
        </Link>
        <Link className="playBackLink" to={`/editor/${encodeURIComponent(projectId)}`} style={{ marginLeft: '12px' }}>
          Editor
        </Link>
        <span className="playTitle">Play — {projectId}</span>
      </header>
      <div className="playCanvasHost">
        {error ? <div className="playMessage playMessageError">{error}</div> : null}
        {!error && !manifest ? (
          <div className="playMessage">Loading manifest…</div>
        ) : null}
        {manifest ? (
          <PlayViewport manifest={manifest} projectId={projectId} onMetricsUpdate={setMetrics} />
        ) : null}
      </div>
      {manifest ? <PlayMetricsFooter metrics={metrics} /> : null}
    </div>
  )
}
