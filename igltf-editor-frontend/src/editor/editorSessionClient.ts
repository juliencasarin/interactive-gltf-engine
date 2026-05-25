import { useEffect, useRef, useState } from 'react'
import { editorSessionUrl } from '@/api/projectApi'
import type { ProjectFileV2 } from './types'
import { dispatchEditorMcpCommand, isSceneMutationCommand, sceneMutationBlockedError, type EditorMcpCommandHandlers } from './editorMcpCommands'

export type EditorSessionStatus = 'idle' | 'connecting' | 'open' | 'error'

export type UseEditorSessionOptions = {
  projectId: string
  enabled: boolean
  revision: number
  mcpAllowSceneEdition: boolean
  buildSnapshot: () => ProjectFileV2
  commandHandlers: EditorMcpCommandHandlers
}

export function useEditorSessionWs(opts: UseEditorSessionOptions): EditorSessionStatus {
  const { projectId, enabled, revision, mcpAllowSceneEdition, buildSnapshot, commandHandlers } = opts

  const [status, setStatus] = useState<EditorSessionStatus>('idle')
  const wsRef = useRef<WebSocket | null>(null)
  const connectionGenRef = useRef(0)
  const revisionRef = useRef(revision)
  const mcpRef = useRef(mcpAllowSceneEdition)
  const buildSnapshotRef = useRef(buildSnapshot)
  const handlersRef = useRef(commandHandlers)

  revisionRef.current = revision
  mcpRef.current = mcpAllowSceneEdition
  buildSnapshotRef.current = buildSnapshot
  handlersRef.current = commandHandlers

  const pushSnapshot = (ws: WebSocket, kind: 'session_register' | 'session_update') => {
    ws.send(
      JSON.stringify({
        type: kind,
        revision: revisionRef.current,
        mcpAllowSceneEdition: mcpRef.current,
        snapshot: buildSnapshotRef.current(),
      }),
    )
  }

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      return
    }

    const url = editorSessionUrl(projectId)
    if (!url) {
      setStatus('idle')
      return
    }

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const scheduleReconnect = (gen: number) => {
      if (cancelled || gen !== connectionGenRef.current) return
      attempt += 1
      const ms = Math.min(15_000, 1000 * Math.min(64, Math.pow(2, Math.min(attempt, 6))))
      retryTimer = globalThis.setTimeout(() => connect(gen), ms)
    }

    const connect = (gen: number) => {
      if (cancelled || gen !== connectionGenRef.current) return
      setStatus('connecting')
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled || gen !== connectionGenRef.current) {
          if (ws.readyState === WebSocket.OPEN) ws.close()
          return
        }
        attempt = 0
        setStatus('open')
        pushSnapshot(ws, 'session_register')
      }

      ws.onerror = () => {
        if (cancelled || gen !== connectionGenRef.current) return
        setStatus((s) => (s === 'connecting' ? 'error' : s))
      }

      ws.onclose = () => {
        if (cancelled || gen !== connectionGenRef.current) return
        wsRef.current = null
        setStatus('error')
        scheduleReconnect(gen)
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type?: string
            requestId?: string
            op?: string
            params?: Record<string, unknown>
          }
          if (msg.type === 'hello') return
          if (msg.type !== 'command' || !msg.requestId || !msg.op) return

          if (isSceneMutationCommand(msg.op, msg.params ?? {}) && !mcpRef.current) {
            ws.send(
              JSON.stringify({
                type: 'command_result',
                requestId: msg.requestId,
                ok: false,
                revision: revisionRef.current,
                error: sceneMutationBlockedError(),
              }),
            )
            return
          }

          void (async () => {
            try {
              const result = await Promise.resolve(
                dispatchEditorMcpCommand(msg.op!, msg.params ?? {}, handlersRef.current),
              )
              ws.send(
                JSON.stringify({
                  type: 'command_result',
                  requestId: msg.requestId,
                  ok: result.ok,
                  revision: result.ok ? result.revision : revisionRef.current,
                  error: result.ok ? undefined : result.error,
                  result: result.ok ? result.result : undefined,
                }),
              )
            } catch (e) {
              ws.send(
                JSON.stringify({
                  type: 'command_result',
                  requestId: msg.requestId,
                  ok: false,
                  revision: revisionRef.current,
                  error: {
                    code: 'command_failed',
                    message: e instanceof Error ? e.message : 'Command failed',
                  },
                }),
              )
            }
          })()
        } catch {
          /* ignore */
        }
      }
    }

    const gen = ++connectionGenRef.current
    connect(gen)

    return () => {
      cancelled = true
      connectionGenRef.current += 1
      if (retryTimer) clearTimeout(retryTimer)
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
          ws.close()
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.addEventListener(
            'open',
            () => {
              ws.close()
            },
            { once: true },
          )
        }
      }
      setStatus('idle')
    }
  }, [enabled, projectId])

  useEffect(() => {
    const ws = wsRef.current
    if (!enabled || !ws || ws.readyState !== WebSocket.OPEN) return

    const timer = globalThis.setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        pushSnapshot(wsRef.current, 'session_update')
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [enabled, revision, mcpAllowSceneEdition, buildSnapshot])

  return status
}
