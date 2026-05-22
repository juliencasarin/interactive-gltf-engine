/** Root-relative module URL (Vite `public/igltf-core/gltf-script.js`). */
export const GLTF_SCRIPT_IMPORT_PATH = '/igltf-core/gltf-script.js'

/** Root-relative module URL (Vite `public/igltf-core/interaction-bases.js`). */
export const INTERACTION_BASES_IMPORT_PATH = '/igltf-core/interaction-bases.js'

const IGLTF_CORE_IMPORTS: { pattern: string; path: string }[] = [
  { pattern: '/igltf-core/gltf-script.js', path: GLTF_SCRIPT_IMPORT_PATH },
  { pattern: '/igltf-core/interaction-bases.js', path: INTERACTION_BASES_IMPORT_PATH },
]

/**
 * Dynamic `import(blobUrl)` modules cannot resolve root-relative specifiers like `/igltf-core/...`.
 * Rewrite static imports to an absolute document URL so preview + introspection loaders work.
 */
export function rewriteIgltfCoreImportsForBlobModule(source: string): string {
  if (typeof document === 'undefined') return source
  let out = source
  for (const { pattern, path } of IGLTF_CORE_IMPORTS) {
    const abs = new URL(path, document.baseURI).href
    const escaped = pattern.replace(/\//g, '\\/')
    const re = new RegExp(`from\\s+(['"])${escaped}\\1`, 'g')
    out = out.replace(re, () => `from ${JSON.stringify(abs)}`)
  }
  return out
}

/** @deprecated Use {@link rewriteIgltfCoreImportsForBlobModule}. */
export function rewriteInteractionBasesImportsForBlobModule(source: string): string {
  return rewriteIgltfCoreImportsForBlobModule(source)
}

/** Preload viewer core modules so bundled classic scripts can resolve external `/igltf-core/*` imports. */
export async function preloadIgltfCoreModules(): Promise<void> {
  if (typeof document === 'undefined') return
  const scriptUrl = new URL(GLTF_SCRIPT_IMPORT_PATH, document.baseURI).href
  const basesUrl = new URL(INTERACTION_BASES_IMPORT_PATH, document.baseURI).href
  await import(/* @vite-ignore */ scriptUrl)
  await import(/* @vite-ignore */ basesUrl)
}
