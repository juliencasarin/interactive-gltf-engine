import { useParams } from 'react-router-dom'
import { EditorProvider } from '@/editor/EditorContext'
import { EditorShell } from '@/layout/EditorShell'

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const sceneId = id ?? 'test'

  return (
    <EditorProvider projectId={sceneId}>
      <EditorShell sceneId={sceneId} />
    </EditorProvider>
  )
}