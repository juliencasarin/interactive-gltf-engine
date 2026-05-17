/** Root-relative module URL (Vite `public/igltf-core/interaction-bases.js`). */
export const INTERACTION_BASES_IMPORT_PATH = '/igltf-core/interaction-bases.js'

/**
 * Dynamic `import(blobUrl)` modules cannot resolve root-relative specifiers like `/igltf-core/...`.
 * Rewrite static imports to an absolute document URL so preview + introspection loaders work.
 */
export function rewriteInteractionBasesImportsForBlobModule(source: string): string {
  if (typeof document === 'undefined') return source
  const abs = new URL(INTERACTION_BASES_IMPORT_PATH, document.baseURI).href
  return source.replace(
    /from\s+(['"])\/igltf-core\/interaction-bases\.js\1/g,
    () => `from ${JSON.stringify(abs)}`,
  )
}
