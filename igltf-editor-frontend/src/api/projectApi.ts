import type { ProjectFileV2 } from '@/editor/types'

export function getApiBase(): string {
  const v = import.meta.env.VITE_API_BASE_URL
  if (v == null || v === '') return ''
  return String(v).replace(/\/$/, '')
}

export function isApiConfigured(): boolean {
  return getApiBase() !== ''
}

export async function fetchDocument(projectId: string): Promise<ProjectFileV2 | null> {
  const base = getApiBase()
  const res = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/document`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error((await res.text()) || `GET document ${res.status}`)
  return res.json() as Promise<ProjectFileV2>
}

export async function putDocument(projectId: string, doc: ProjectFileV2): Promise<ProjectFileV2> {
  const base = getApiBase()
  const res = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/document`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
  if (!res.ok) throw new Error((await res.text()) || `PUT document ${res.status}`)
  const data = (await res.json()) as { document?: ProjectFileV2 }
  if (!data.document || data.document.version !== 2) {
    throw new Error('PUT response missing document')
  }
  return data.document
}

export type UploadAssetResult = {
  assetId: string
  relativePath: string
  url: string
}

export async function uploadAssetStage(projectId: string, file: File): Promise<UploadAssetResult> {
  const base = getApiBase()
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/assets/stage`, {
    method: 'POST',
    body: fd,
  })
  if (!res.ok) throw new Error((await res.text()) || `POST asset stage ${res.status}`)
  return res.json() as Promise<UploadAssetResult>
}
