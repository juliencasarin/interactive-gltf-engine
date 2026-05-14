/** Virtual catalog paths inside the project (`logicalFolder`): segments joined by `/`, no leading/trailing slashes. */

export function normalizeLogicalFolder(folder: string | undefined | null): string {
  if (!folder) return ''
  return folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
}

export function folderSegments(path: string): string[] {
  const n = normalizeLogicalFolder(path)
  return n ? n.split('/').filter(Boolean) : []
}

export function normalizeFolderSegments(segments: string[]): string {
  const parts = segments.map((s) => s.replace(/\\/g, '/').split('/')).flat().filter(Boolean)
  return parts.join('/')
}

export function isUnderFolder(assetFolder: string, folderPrefix: string[]): boolean {
  const af = normalizeLogicalFolder(assetFolder)
  const pref = normalizeFolderSegments(folderPrefix)
  if (!pref.length) return true
  if (!af) return false
  if (af === pref) return true
  return af.startsWith(`${pref}/`)
}

export function deriveFolderPrefixes(assets: { logicalFolder?: string }[]): Set<string> {
  const paths = new Set<string>()
  for (const a of assets) {
    const n = normalizeLogicalFolder(a.logicalFolder)
    if (!n) continue
    const seg = n.split('/')
    for (let i = 1; i <= seg.length; i++) paths.add(seg.slice(0, i).join('/'))
  }
  return paths
}
