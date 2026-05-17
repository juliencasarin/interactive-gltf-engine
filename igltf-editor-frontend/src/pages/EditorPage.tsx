import { Navigate, useParams } from 'react-router-dom'
import { EditorProvider } from '@/editor/EditorContext'
import { EditorShell } from '@/layout/EditorShell'

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) {
    return <Navigate to="/" replace />
  }
  const sceneId = id

  return (
    <EditorProvider projectId={sceneId}>
      <EditorShell sceneId={sceneId} />
    </EditorProvider>
  )
}
