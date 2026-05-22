import type { PlayRuntimeMetrics } from './PlayMetricsCollector'
import { formatMetricCount } from './playSceneMetrics'

type Props = {
  metrics: PlayRuntimeMetrics | null
}

export function PlayMetricsFooter({ metrics }: Props) {
  return (
    <footer className="playFooter" aria-live="polite">
      {metrics ? (
        <>
          <span>FPS {metrics.fps}</span>
          <span className="playFooterSep">|</span>
          <span>Draw {metrics.drawCalls}</span>
          <span className="playFooterSep">|</span>
          <span>
            Tris {formatMetricCount(metrics.renderedTriangles)} /{' '}
            {formatMetricCount(metrics.sceneTriangles)}
          </span>
          <span className="playFooterSep">|</span>
          <span>Meshes {metrics.meshCount}</span>
          <span className="playFooterSep">|</span>
          <span>Materials {metrics.materialCount}</span>
          <span className="playFooterSep">|</span>
          <span>Nodes {metrics.nodeCount}</span>
        </>
      ) : (
        <span className="playFooterMuted">—</span>
      )}
    </footer>
  )
}
