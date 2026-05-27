import type { ProjectFileV2 } from '@/editor/types'
import type { ProjectAssetEntry } from '@/editor/types'

export function getApiBase(): string {
  const v = import.meta.env.VITE_API_BASE_URL
  if (v == null || v === '') return ''
  return String(v).replace(/\/$/, '')
}

export function isApiConfigured(): boolean {
  return getApiBase() !== ''
}

/** Browser WebSocket URL for `/projects/:id/assets/watch` (reflects HTTP base + path prefix). */
export function wsUrlForProjectPath(projectId: string, suffix: string): string | null {
  const base = getApiBase()
  if (!base) return null
  try {
    const u = new URL(base)
    const scheme = u.protocol === 'https:' ? 'wss:' : 'ws:'
    const prefix = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : ''
    const path = `/projects/${encodeURIComponent(projectId)}/${suffix}`
    return `${scheme}//${u.host}${prefix}${path}`
  } catch {
    return null
  }
}

export function assetsWatchUrl(projectId: string): string | null {
  return wsUrlForProjectPath(projectId, 'assets/watch')
}

export function editorSessionUrl(projectId: string): string | null {
  return wsUrlForProjectPath(projectId, 'editor/session')
}

const LOCAL_API_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'tauri.localhost',
])

function openIdeEnvMode(): 'on' | 'off' | 'auto' {
  const v = import.meta.env.VITE_OPEN_IN_IDE
  if (v == null || v === '') return 'auto'
  const s = String(v).trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(s)) return 'off'
  if (['1', 'true', 'yes', 'on'].includes(s)) return 'on'
  return 'auto'
}

/** True when `VITE_API_BASE_URL` points at a loopback host (local authoring). */
export function isLocalApiBase(): boolean {
  const base = getApiBase()
  if (!base) return false
  try {
    const host = new URL(base).hostname.toLowerCase()
    return LOCAL_API_HOSTS.has(host)
  } catch {
    return false
  }
}

/**
 * Show "Open in IDE" only for local API URLs, unless `VITE_OPEN_IN_IDE=1` (e.g. LAN same-machine);
 * set `VITE_OPEN_IN_IDE=0` to hide even when local.
 */
export function isOpenIdeEnabled(): boolean {
  if (!isApiConfigured()) return false
  const mode = openIdeEnvMode()
  if (mode === 'off') return false
  if (mode === 'on') return true
  return isLocalApiBase()
}

export async function fetchDocument(projectId: string): Promise<ProjectFileV2 | null> {
  const base = getApiBase()
  const res = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/document`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error((await res.text()) || `GET document ${res.status}`)
  return res.json() as Promise<ProjectFileV2>
}

export type AssetCatalogSnapshot = {
  assets: ProjectAssetEntry[]
  assetFolders?: string[]
}

export async function fetchAssetCatalog(projectId: string): Promise<AssetCatalogSnapshot> {
  const base = getApiBase()
  const res = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/assets/catalog`)
  if (!res.ok) throw new Error((await res.text()) || `GET asset catalog ${res.status}`)
  return res.json() as Promise<AssetCatalogSnapshot>
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

export type RenameScriptStemResult = {
  status: 'ok'
  relativePath: string
  scriptExports: string[]
  mismatch: boolean
}

export async function renameScriptStem(
  projectId: string,
  assetId: string,
  stem: string,
): Promise<RenameScriptStemResult> {
  const base = getApiBase()
  const res = await fetch(
    `${base}/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/rename-stem`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stem }),
    },
  )
  if (!res.ok) throw new Error((await res.text()) || `rename-stem ${res.status}`)
  return res.json() as Promise<RenameScriptStemResult>
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

export async function fetchAssetSource(projectId: string, assetId: string): Promise<string> {
  const base = getApiBase()
  const res = await fetch(
    `${base}/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/source`,
  )
  if (!res.ok) throw new Error((await res.text()) || `GET script source ${res.status}`)
  return res.text()
}

export type GltfInteriorManifestRow = {
  index: number
  parentIndex: number | null
  name: string
  hasMesh: boolean
  hasSkin: boolean
}

export type GltfInteriorManifest = {
  defaultSceneRoots: number[]
  preorderIndices: number[]
  nodes: GltfInteriorManifestRow[]
  assetId?: string
  relativePath?: string
}

export async function fetchGltfInteriorManifest(
  projectId: string,
  assetId: string,
): Promise<GltfInteriorManifest> {
  const base = getApiBase()
  const res = await fetch(
    `${base}/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/gltf-interior-manifest`,
  )
  if (!res.ok) throw new Error((await res.text()) || `GET gltf-interior-manifest ${res.status}`)
  return res.json() as Promise<GltfInteriorManifest>
}

export async function putAssetSource(
  projectId: string,
  assetId: string,
  content: string,
): Promise<void> {
  const base = getApiBase()
  const res = await fetch(
    `${base}/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/source`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  )
  if (!res.ok) throw new Error((await res.text()) || `PUT script source ${res.status}`)
}

/** Absolute project directory on the API host (`GET …/dev-local-path`); null on 404. */
export async function fetchDevLocalProjectPath(projectId: string): Promise<string | null> {
  const base = getApiBase()
  const res = await fetch(
    `${base}/projects/${encodeURIComponent(projectId)}/dev-local-path`,
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error((await res.text()) || `GET dev-local-path ${res.status}`)
  const data = (await res.json()) as { path?: string }
  return typeof data.path === 'string' ? data.path : null
}

export type PlayManifest = {
  glbUrl: string
  jsUrl?: string
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  const t = await res.text().catch(() => '')
  try {
    const j = JSON.parse(t) as { detail?: unknown }
    if (typeof j.detail === 'string') return j.detail
    if (Array.isArray(j.detail) && j.detail.length && typeof j.detail[0] === 'object') {
      const msg = (j.detail[0] as { msg?: string }).msg
      if (typeof msg === 'string') return msg
    }
  } catch {
    /* ignore */
  }
  return t || fallback
}

/** Spawn IDE on the API host via CLI (e.g. ``cursor -n``); not for remote-hosted APIs. */
export type OpenIdePresetApi = 'cursor' | 'vscode' | 'jetbrains'

export async function postOpenInIde(projectId: string, preset: OpenIdePresetApi): Promise<void> {
  const base = getApiBase()
  const res = await fetch(
    `${base}/projects/${encodeURIComponent(projectId)}/open-in-ide?preset=${encodeURIComponent(preset)}`,
    { method: 'POST' },
  )
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `POST open-in-ide ${res.status}`))
  }
}

export async function fetchPlayManifest(projectId: string): Promise<PlayManifest> {
  const base = getApiBase()
  const res = await fetch(`${base}/play/${encodeURIComponent(projectId)}`)
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `GET play ${res.status}`))
  }
  return res.json() as Promise<PlayManifest>
}

export async function postBuildPlayGlb(projectId: string): Promise<void> {
  const base = getApiBase()
  const res = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/build-play-glb`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `POST build-play-glb ${res.status}`))
  }
}

export type StudioProjectRow = {
  id: string
  diskPath: string
  displayName: string
  lastSavedAt: string | null
  savedWithEngineVersion: string | null
}

export async function fetchStudioProjects(): Promise<StudioProjectRow[]> {
  const base = getApiBase()
  const res = await fetch(`${base}/studio/projects`)
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `GET studio/projects ${res.status}`))
  }
  return res.json() as Promise<StudioProjectRow[]>
}

export async function postStudioCreateProject(
  parentDirectory: string,
  folderName: string,
): Promise<{ id: string }> {
  const base = getApiBase()
  const res = await fetch(`${base}/studio/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentDirectory, folderName }),
  })
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `POST studio/projects/create ${res.status}`))
  }
  return res.json() as Promise<{ id: string }>
}

export async function postStudioRegisterProject(projectDirectory: string): Promise<{ id: string }> {
  const base = getApiBase()
  const res = await fetch(`${base}/studio/projects/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDirectory }),
  })
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `POST studio/projects/register ${res.status}`))
  }
  return res.json() as Promise<{ id: string }>
}

export async function deleteStudioUnregisterProject(projectId: string): Promise<void> {
  const base = getApiBase()
  const res = await fetch(`${base}/studio/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `DELETE studio/projects ${res.status}`))
  }
}

export async function fetchHealth(): Promise<{ status?: string; engineVersion?: string }> {
  const base = getApiBase()
  const res = await fetch(`${base}/health`)
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `GET health ${res.status}`))
  }
  return res.json() as Promise<{ status?: string; engineVersion?: string }>
}
