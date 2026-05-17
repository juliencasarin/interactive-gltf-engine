export type IdePreset = 'cursor' | 'vscode' | 'jetbrains' | 'custom'

const STORAGE_KEY = 'igltf-editor.ide-open-prefs'

export type IdeOpenPrefs = {
  preset: IdePreset
  /** Parent of per-project folders (same as backend STORAGE_ROOT when local). */
  localRoot: string
  /** Used when preset is custom; `{path}` = filesystem path with forward slashes. */
  customTemplate: string
}

/** Backend STORAGE_ROOT equivalent for local dev (from `.env`), when user has not set `localRoot` in prefs. */
export function devStorageRootFromEnv(): string {
  const v = import.meta.env.VITE_DEV_STORAGE_ROOT
  return typeof v === 'string' ? v.trim() : ''
}

function effectiveStorageParent(prefs: IdeOpenPrefs): string {
  const saved = prefs.localRoot.trim()
  if (saved) return saved
  return devStorageRootFromEnv()
}

export function loadIdeOpenPrefs(): IdeOpenPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<IdeOpenPrefs>
      return {
        preset: (p.preset as IdePreset) ?? 'cursor',
        localRoot: typeof p.localRoot === 'string' ? p.localRoot : '',
        customTemplate:
          typeof p.customTemplate === 'string' && p.customTemplate.trim()
            ? p.customTemplate.trim()
            : 'cursor://file/{path}',
      }
    }
  } catch {
    /* ignore */
  }
  return { preset: 'cursor', localRoot: '', customTemplate: 'cursor://file/{path}' }
}

export function saveIdeOpenPrefs(p: IdeOpenPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

/** Join storage root and project id for a local folder path (display / shell). */
export function localProjectFolderPath(localRoot: string, projectId: string): string {
  const a = localRoot.replace(/[/\\]+$/, '')
  if (!a) return projectId
  const sep = a.includes('\\') && !a.includes('/') ? '\\' : '/'
  return `${a}${sep}${projectId}`
}

/** True if `root` already points at this project's folder. */
export function isFullProjectPath(root: string, projectId: string): boolean {
  const segments = root.replace(/[/\\]+$/, '').split(/[/\\]/)
  return segments[segments.length - 1] === projectId
}

export function resolvedLocalProjectFolder(prefs: IdeOpenPrefs, projectId: string): string {
  const r = effectiveStorageParent(prefs)
  if (!r) return ''
  const norm = r.replace(/[/\\]+$/, '')
  if (isFullProjectPath(norm, projectId)) return norm
  return localProjectFolderPath(norm, projectId)
}

/**
 * Build deep link for a known absolute project folder path (preferred when the API exposes it).
 */
export function ideOpenDeepLinkAbsolute(prefs: IdeOpenPrefs, absoluteFolderPath: string): string {
  const path = absoluteFolderPath.trim().replace(/\\/g, '/')
  if (!path) return ''
  if (prefs.preset === 'custom') {
    return prefs.customTemplate.split('{path}').join(path)
  }
  if (prefs.preset === 'vscode') {
    return `vscode://file/${path}`
  }
  if (prefs.preset === 'jetbrains') {
    return `idea://open?file=${encodeURIComponent(path)}`
  }
  return `cursor://file/${path}`
}

export function shellOpenCommandAbsolute(prefs: IdeOpenPrefs, absoluteFolderPath: string): string {
  const folder = absoluteFolderPath.trim()
  if (!folder) return ''
  if (prefs.preset === 'vscode') return `code -n "${folder}"`
  if (prefs.preset === 'cursor') return `cursor -n "${folder}"`
  if (prefs.preset === 'jetbrains') return `idea "${folder}"`
  return `cd /d "${folder}"`
}

/**
 * Build deep link. Uses forward slashes (required by VS Code / Cursor URL handlers on Windows).
 */
export function ideOpenDeepLink(prefs: IdeOpenPrefs, projectId: string): string {
  const raw = resolvedLocalProjectFolder(prefs, projectId)
  return ideOpenDeepLinkAbsolute(prefs, raw)
}

export function shellOpenCommand(prefs: IdeOpenPrefs, projectId: string): string {
  return shellOpenCommandAbsolute(prefs, resolvedLocalProjectFolder(prefs, projectId))
}
