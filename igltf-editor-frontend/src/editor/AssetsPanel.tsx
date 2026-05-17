import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useEditor } from './EditorContext'
import {
  deriveFolderPrefixes,
  isUnderFolder,
  normalizeFolderSegments,
  normalizeLogicalFolder,
} from './folderUtils'
import { DEFAULT_SCRIPT_TEMPLATE } from '@/scriptRuntime/monacoSetup'
import { INTERACTION_TEMPLATE_MENU, type InteractionTemplateKind } from '@/scriptRuntime/interactionScriptTemplates'
import { catalogAssetStem, isGltfAssetEntry, isScriptAssetEntry } from './assetUtils'
import { MIME_ASSET, dragOverLooksLikeAsset } from './dndTypes'
import { isApiConfigured, renameScriptStem } from '@/api/projectApi'
import { ScriptAssetEditor } from './ScriptAssetEditor'
import type { ScriptRole, ProjectAssetEntry } from './types'
import './panels.css'

function fileExtensionLabel(relativePath: string): string {
  const base = relativePath.trim().replace(/^.*[/\\]/, '')
  const m = /\.([a-z0-9]{1,16})$/i.exec(base)
  return m?.[1] ? m[1].toUpperCase() : '—'
}

function assetExplorerLabel(entry: ProjectAssetEntry): string {
  if (isScriptAssetEntry(entry)) return catalogAssetStem(entry.relativePath)
  return (entry.name && entry.name.trim()) || `${entry.relativePath}`
}

function allCatalogPathSet(
  assets: { logicalFolder?: string }[],
  explicitFolders: string[],
): Set<string> {
  const s = deriveFolderPrefixes(assets)
  for (const raw of explicitFolders) {
    const n = normalizeLogicalFolder(raw)
    if (!n) continue
    const seg = n.split('/')
    for (let i = 1; i <= seg.length; i++) s.add(seg.slice(0, i).join('/'))
  }
  return s
}

function childFolderNames(parentSegments: string[], allPaths: Set<string>): string[] {
  const pref = normalizeFolderSegments(parentSegments)
  const names = new Set<string>()
  for (const full of allPaths) {
    if (!full) continue
    if (!pref.length) {
      names.add(full.split('/')[0]!)
      continue
    }
    if (full === pref) continue
    if (!full.startsWith(`${pref}/`)) continue
    const rest = full.slice(pref.length + 1)
    const head = rest.split('/')[0]
    if (head) names.add(head)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Left column: virtual folder tree (Sketcher library strip — US-SK-060). */
export function AssetsCatalogTree() {
  const { projectAssets, assetFoldersExplicit, setPanelFocus, setAssetExplorerPath, moveAssetLogicalFolder } =
    useEditor()

  const [expandedLib, setExpandedLib] = useState<Record<string, true>>({ '': true })

  const catalogPaths = useMemo(
    () => allCatalogPathSet(projectAssets, assetFoldersExplicit),
    [projectAssets, assetFoldersExplicit],
  )

  function renderLibBranch(parentSegments: string[], depth: number, keyJoin: string): ReactElement {
    const key = `${keyJoin}:${parentSegments.join('/')}`
    const open = expandedLib[keyJoin] ?? true
    const childrenNames = childFolderNames(parentSegments, catalogPaths)
    const labelPath = normalizeFolderSegments(parentSegments)
    return (
      <div key={key} className="catalogBranch" style={{ marginLeft: depth * 12 }}>
        {parentSegments.length > 0 ? (
          <div className="catalogRowWrap">
            <button
              type="button"
              aria-label={open ? 'Collapse' : 'Expand'}
              className={`catalogCaret${open ? ' catalogCaretOpen' : ''}`}
              disabled={childrenNames.length === 0}
              onClick={() =>
                setExpandedLib((prev) => {
                  const next = { ...prev }
                  if (next[keyJoin]) delete next[keyJoin]
                  else next[keyJoin] = true
                  return next
                })
              }
            />
            <button
              type="button"
              className="catalogFolderRow"
              onDragOver={(e) => {
                if (dragOverLooksLikeAsset(e.dataTransfer)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const aid =
                  e.dataTransfer.getData(MIME_ASSET) || e.dataTransfer.getData('text/plain').trim()
                if (!aid) return
                moveAssetLogicalFolder(aid, parentSegments)
              }}
              onClick={() => {
                setPanelFocus('assets')
                setAssetExplorerPath(parentSegments)
              }}
            >
              {parentSegments[parentSegments.length - 1]}
              <span className="catalogPathHint"> · {labelPath}</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="catalogProjectRoot"
            onClick={() => {
              setPanelFocus('assets')
              setAssetExplorerPath([])
            }}
          >
            Project
          </button>
        )}

        {open
          ? childrenNames.map((n) =>
              renderLibBranch(
                [...parentSegments, n],
                depth + (parentSegments.length ? 1 : 0),
                `${keyJoin}/${n}`,
              ),
            )
          : null}
      </div>
    )
  }

  return (
    <div className="assetsLibrariesBodyInner" onMouseDown={() => setPanelFocus('assets')}>
      {renderLibBranch([], 0, '')}
    </div>
  )
}

type AssetMenuState = { clientX: number; clientY: number; assetId: string | null }

/** Right column: breadcrumb, filtered list, footer, properties (US-SK-062 … 065). */
export function AssetsExplorerPanel() {
  const {
    projectId,
    projectAssets,
    assetExplorerPath,
    panelFocus,
    setPanelFocus,
    setAssetExplorerPath,
    addGltfFromFile,
    addInteractionScriptAsset,
    deleteProjectAssetsConfirm,
    updateProjectAsset,
    addExplicitAssetFolder,
    assetsDiskWatch,
  } = useEditor()

  const [filter, setFilter] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [menu, setMenu] = useState<AssetMenuState | null>(null)
  const [propsMenuOpen, setPropsMenuOpen] = useState(false)
  const propsHeaderRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelectedAssetId(null)
  }, [assetExplorerPath])

  useEffect(() => setPropsMenuOpen(false), [assetExplorerPath, selectedAssetId])

  useEffect(() => {
    if (!propsMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (propsHeaderRef.current?.contains(e.target as Node)) return
      setPropsMenuOpen(false)
    }
    window.addEventListener('mousedown', onDoc, true)
    return () => window.removeEventListener('mousedown', onDoc, true)
  }, [propsMenuOpen])

  const visibleAssets = useMemo(() => {
    const fq = filter.trim().toLowerCase()
    return projectAssets.filter((a) => {
      if (!isUnderFolder(normalizeLogicalFolder(a.logicalFolder), assetExplorerPath)) return false
      if (!fq) return true
      const label = assetExplorerLabel(a).toLowerCase()
      return label.includes(fq)
    })
  }, [projectAssets, assetExplorerPath, filter])

  const selectedAsset =
    visibleAssets.find((a) => a.assetId === selectedAssetId) ??
    projectAssets.find((a) => a.assetId === selectedAssetId) ??
    null

  const onImportFiles = async (files: FileList | null) => {
    if (!files?.length) return
    for (let i = 0; i < files.length; i++) {
      try {
        await addGltfFromFile(files[i]!)
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const clearAssetSelection = useCallback(() => {
    setSelectedAssetId(null)
    setPropsMenuOpen(false)
  }, [])

  useEffect(() => {
    if (!selectedAssetId || panelFocus !== 'assets') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      e.preventDefault()
      clearAssetSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedAssetId, panelFocus, clearAssetSelection])

  function openRenamePromptFor(assetId: string, currentName?: string) {
    const a = projectAssets.find((x) => x.assetId === assetId)
    const nn = window.prompt(
      'Rename catalog label',
      currentName ?? a?.name ?? a?.relativePath ?? '',
    )
    if (!nn?.trim()) return
    updateProjectAsset(assetId, { name: nn.trim() })
  }

  async function openRenameScriptStemPrompt(assetId: string) {
    const a = projectAssets.find((x) => x.assetId === assetId)
    if (!a || !isScriptAssetEntry(a)) return
    if (!isApiConfigured()) {
      window.alert('Connect the authoring API so the backend can rename the script file.')
      return
    }
    const stem0 = catalogAssetStem(a.relativePath)
    const next = window.prompt('Rename script — new filename stem (no extension)', stem0)
    if (!next?.trim()) return
    try {
      const res = await renameScriptStem(projectId, assetId, next.trim())
      updateProjectAsset(assetId, {
        relativePath: res.relativePath,
        scriptExports: [...res.scriptExports],
        name: undefined,
      })
      if (res.mismatch) {
        window.alert(
          'The file stem was renamed, but this script still exports a different class name. Rename the exported class in the editor to match the stem, or revert the rename.',
        )
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  function deleteAssetsByMenu(assetIds: string[]) {
    deleteProjectAssetsConfirm(assetIds)
    clearAssetSelection()
    setMenu(null)
  }

  async function createInteractionFromTemplate(kind: InteractionTemplateKind) {
    setMenu(null)
    try {
      const folderLogical = normalizeFolderSegments(assetExplorerPath)
      const id = await addInteractionScriptAsset(kind, {
        logicalFolder: folderLogical || undefined,
      })
      setSelectedAssetId(id)
      setPanelFocus('assets')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <div
        className="assetsExplorerShell"
        role="presentation"
        onMouseDown={() => {
          if (menu) setMenu(null)
        }}
      >
        <div className="divisionHeader assetsExplorerTopHeader">
          <div className="assetsExplorerPathRow">
            <button type="button" className="pathExplorerSketch" onClick={() => setAssetExplorerPath([])}>
              Project
            </button>
            {assetExplorerPath.map((seg, i) => {
              const segments = assetExplorerPath.slice(0, i + 1)
              return (
                <span key={segments.join('/')}>
                  <span className="breadcrumbSepSketch"> / </span>
                  <button
                    type="button"
                    className="pathExplorerSketch"
                    onClick={() => setAssetExplorerPath(segments)}
                  >
                    {seg}
                  </button>
                </span>
              )
            })}
          </div>
          <div className="assetsExplorerHeaderSearchWrap">
            <input
              className="assetsExplorerSearch"
              type="search"
              placeholder="Search…"
              value={filter}
              onChange={(ev) => setFilter(ev.target.value)}
              aria-label="Filter assets in folder"
              onFocus={() => setPanelFocus('assets')}
            />
          </div>
        </div>

        {(assetsDiskWatch === 'connecting' || assetsDiskWatch === 'error') && (
          <div className={`assetsDiskWatchHint assetsDiskWatchHint--${assetsDiskWatch}`} role="status">
            {assetsDiskWatch === 'connecting'
              ? 'Connecting disk sync…'
              : 'Disk sync offline — reconnecting…'}
          </div>
        )}

        <div className="assetsExplorerMiddleRow">
          <div className="assetsExplorerListPane">
            <div
              className="assetsExplorerListScroll"
              role="list"
              onContextMenu={(e) => {
                const row = (e.target as HTMLElement).closest('.assetsExplorerRowFlat')
                if (row) return
                e.preventDefault()
                clearAssetSelection()
                setMenu({ clientX: e.clientX, clientY: e.clientY, assetId: null })
              }}
              onMouseDown={(ev) => {
                ev.stopPropagation()
                const row = (ev.target as HTMLElement).closest('.assetsExplorerRowFlat')
                if (!row) clearAssetSelection()
              }}
            >
              {visibleAssets.length === 0 ? (
                <span className="assetsExplorerEmpty">No assets in this folder</span>
              ) : (
                <ul className="assetsExplorerListFlat">
                  {visibleAssets.map((a) => (
                    <li
                      key={a.assetId}
                      draggable
                      className={`assetsExplorerRowFlat${
                        selectedAssetId === a.assetId ? ' assetsExplorerRowSelected' : ''
                      }`}
                      role="listitem"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPanelFocus('assets')
                        if (selectedAssetId === a.assetId) {
                          clearAssetSelection()
                          return
                        }
                        setSelectedAssetId(a.assetId)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setSelectedAssetId(a.assetId)
                        setMenu({ clientX: e.clientX, clientY: e.clientY, assetId: a.assetId })
                      }}
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData(MIME_ASSET, a.assetId)
                        ev.dataTransfer.setData('text/plain', a.assetId)
                        ev.dataTransfer.effectAllowed = 'copyMove'
                      }}
                    >
                      {assetExplorerLabel(a)}
                      {isScriptAssetEntry(a) ? (
                        <span className="assetsKindBadge assetsKindBadgeScript">script</span>
                      ) : isGltfAssetEntry(a) ? (
                        <span className="assetsKindBadge assetsKindBadgeGltf">gltf</span>
                      ) : null}
                      {a.logicalFolder ? (
                        <span className="assetLogicalPath"> · {normalizeLogicalFolder(a.logicalFolder)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="assetsExplorerVsizer" aria-hidden />
          <aside className="assetsExplorerPropsPane">
            <div className="assetsExplorerPropsHeader" ref={propsHeaderRef}>
              <div className="assetsExplorerPropsTitle">Properties</div>
              <button
                type="button"
                className="assetsPropsOverflowBtn"
                aria-label="Catalog actions"
                title="Actions"
                disabled={!selectedAsset}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!selectedAsset) return
                  setPropsMenuOpen((o) => !o)
                }}
              >
                ⋮
              </button>
              {propsMenuOpen && selectedAsset ? (
                <div
                  className="assetsPropsPopover"
                  role="menu"
                  onMouseDown={(ev) => ev.stopPropagation()}
                >
                  {isScriptAssetEntry(selectedAsset) ? (
                    <button
                      type="button"
                      className="contextMenuItem"
                      role="menuitem"
                      onClick={() => {
                        void openRenameScriptStemPrompt(selectedAsset.assetId)
                        setPropsMenuOpen(false)
                      }}
                    >
                      Rename script file…
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="contextMenuItem"
                      role="menuitem"
                      onClick={() => {
                        openRenamePromptFor(selectedAsset.assetId)
                        setPropsMenuOpen(false)
                      }}
                    >
                      Rename label…
                    </button>
                  )}
                  <button
                    type="button"
                    className="contextMenuItem danger"
                    role="menuitem"
                    onClick={() => deleteAssetsByMenu([selectedAsset.assetId])}
                  >
                    Delete…
                  </button>
                </div>
              ) : null}
            </div>
            <div className="assetsPropsInner">
              {selectedAsset ? (
                <>
                  <div className="assetsPropsRow">
                    <div className="assetsPropsPreview">{fileExtensionLabel(selectedAsset.relativePath)}</div>
                    <div className="assetsPropsTexts">
                      <p className="assetsPropsPrimary" title={selectedAsset.assetId}>
                        {assetExplorerLabel(selectedAsset)}
                      </p>
                      <p className="assetsPropsMuted">{selectedAsset.relativePath}</p>
                      <p className="assetsPropsMuted">
                        {normalizeLogicalFolder(selectedAsset.logicalFolder)
                          ? `${normalizeLogicalFolder(selectedAsset.logicalFolder)}`
                          : 'Project root'}
                        <span className="assetLogicalPath"> · id {selectedAsset.assetId}</span>
                      </p>
                    </div>
                  </div>
                  {isScriptAssetEntry(selectedAsset) ? (
                    <>
                      {selectedAsset.interactionKind ? (
                        <p className="assetsPropsMuted" style={{ marginTop: 6 }}>
                          Interaction template:{' '}
                          {INTERACTION_TEMPLATE_MENU.find((x) => x.kind === selectedAsset.interactionKind)
                            ?.label ?? selectedAsset.interactionKind}
                        </p>
                      ) : null}
                      <label className="inspectorBoolRow" style={{ marginTop: 8 }}>
                        <span className="inspectorBoolLbl">Script role</span>
                        <select
                          className="vecInput"
                          style={{ flex: 1, maxWidth: 180 }}
                          value={selectedAsset.scriptRole ?? 'interaction'}
                          onChange={(ev) =>
                            updateProjectAsset(selectedAsset.assetId, {
                              scriptRole: ev.target.value as ScriptRole,
                            })
                          }
                        >
                          <option value="interaction">interaction</option>
                          <option value="behaviour">behaviour</option>
                        </select>
                      </label>
                      <div className="inspectorBoolRow" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <span className="inspectorBoolLbl">Exported class name</span>
                        <p className="assetsPropsMuted" style={{ margin: 0 }}>
                          This must match the file stem (<code>{catalogAssetStem(selectedAsset.relativePath)}</code>
                          ).
                          <br />
                          Catalog value now:{' '}
                          <code>{selectedAsset.scriptExports?.[0] ?? '(unspecified)'}</code>
                        </p>
                      </div>
                      <ScriptAssetEditor
                        asset={selectedAsset}
                        key={`${selectedAsset.assetId}:${selectedAsset.relativePath}`}
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <p className="assetsPropsPlaceholder">Nothing selected</p>
              )}
            </div>
          </aside>
        </div>

        <div className="assetsFooterBar">
          <input
            ref={importRef}
            type="file"
            className="fileMenuHiddenInput"
            accept=".glb,.gltf,.js,.mjs,.cjs,model/gltf-binary,model/gltf+json,text/javascript"
            multiple
            onChange={(ev) => {
              void onImportFiles(ev.target.files)
              ev.target.value = ''
            }}
          />
          <button type="button" className="footerToolbarBtn" onClick={() => importRef.current?.click()}>
            Import
          </button>
          <select
            className="footerToolbarSelectSketch"
            aria-label="New interaction from template"
            defaultValue=""
            onChange={(ev) => {
              const v = ev.target.value as InteractionTemplateKind | ''
              ev.target.value = ''
              if (!v) return
              void createInteractionFromTemplate(v)
            }}
          >
            <option value="">New interaction…</option>
            {INTERACTION_TEMPLATE_MENU.map(({ kind, label }) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="footerToolbarBtn"
            title="Create a new ES module script in this folder"
            onClick={() => {
              const f = new File([DEFAULT_SCRIPT_TEMPLATE], 'ExampleInteraction.js', {
                type: 'text/javascript',
              })
              void (async () => {
                try {
                  await addGltfFromFile(f)
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : String(e))
                }
              })()
            }}
          >
            New script
          </button>
          <button
            type="button"
            className="footerToolbarBtn"
            onClick={() => {
              const suggested = normalizeFolderSegments(assetExplorerPath)
              const nm = window.prompt('New folder name (under current path)', '')
              if (!nm?.trim()) return
              const extra = nm
                .trim()
                .split('/')
                .flatMap((x) => x.split('\\'))
                .filter(Boolean)
              addExplicitAssetFolder([...(suggested ? suggested.split('/') : []), ...extra])
            }}
          >
            New folder
          </button>
          <button
            type="button"
            className="footerToolbarBtn dangerGhost"
            disabled={!selectedAssetId}
            onClick={() => {
              if (!selectedAssetId) return
              deleteProjectAssetsConfirm([selectedAssetId])
              setSelectedAssetId(null)
            }}
          >
            Remove asset…
          </button>
        </div>
      </div>

      {menu ? (
        <div className="contextMenuBackdrop" role="presentation" onMouseDown={() => setMenu(null)}>
          <div
            className="contextMenu contextMenuElevated"
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ left: menu.clientX, top: menu.clientY }}
          >
            <div className="contextMenuStaticRow contextMenuItemWithSub" role="presentation" tabIndex={-1}>
              New interaction<span className="contextMenuCaretSub">▸</span>
              <div className="contextMenuSub" role="presentation">
                {INTERACTION_TEMPLATE_MENU.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    className="contextMenuItem"
                    role="menuitem"
                    onClick={() => void createInteractionFromTemplate(kind)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {menu.assetId ? (
              <>
                {(() => {
                  const row = projectAssets.find((x) => x.assetId === menu.assetId)
                  if (!row) return null
                  if (isScriptAssetEntry(row)) {
                    return (
                      <button
                        type="button"
                        className="contextMenuItem"
                        role="menuitem"
                        onClick={() => {
                          void openRenameScriptStemPrompt(menu.assetId!)
                          setMenu(null)
                        }}
                      >
                        Rename script file…
                      </button>
                    )
                  }
                  return (
                    <button
                      type="button"
                      className="contextMenuItem"
                      role="menuitem"
                      onClick={() => {
                        openRenamePromptFor(menu.assetId!)
                        setMenu(null)
                      }}
                    >
                      Rename label…
                    </button>
                  )
                })()}
                <button
                  type="button"
                  className="contextMenuItem danger"
                  role="menuitem"
                  onClick={() => deleteAssetsByMenu([menu.assetId!])}
                >
                  Delete…
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
