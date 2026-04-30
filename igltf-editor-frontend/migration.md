# Migration notes: UMI3D Sketcher scene editor → web editor (`igltf-editor-frontend`)

This document inventories the **scene editing workspace** in **UMI3D Sketcher** (Intraverse) as implemented in Unity UI Toolkit, to guide a **web** rebuild for **interactive-gltf-engine**. It is descriptive, not normative.

**Phase 1 user stories** (IDs, priorities, acceptance criteria, design fidelity contract): [`../docs/sketcher-migration/phase1-user-stories.md`](../docs/sketcher-migration/phase1-user-stories.md).

**Sources (read-only reference):**

- Layout: `UMI3D-Sketcher-no-history-2.11/Intraverse/Assets/Scripts/UI/UXML/UI_DTM.uxml` (root `editor` → `screen` inside `editorContainer` from `Main.uxml`).
- Wiring: `…/Scripts/UI/UIManager.cs`, `…/Scripts/UI/Inspector/InspectorPanel.cs`, `…/Scripts/UI/Assets/AssetsPanel.cs`, `…/Scripts/UI/ImportAsset/ImportAssetPanel.cs`, `…/Scripts/UI/ImportAsset/ImporterItem.cs`, `…/Scripts/UI/DragAndDrop/{DragAndDropRuntime,DropManipulator}.cs`, `…/Scripts/PlayAPI.cs`, `…/Scripts/Connector/LocalLibrary.cs`, `…/Scripts/Connector/Local Loaders/*.cs`, `…/Scripts/UI/Viewport/ContextualMenu.cs`, `…/Scripts/UI/Server/ServerToolElement.cs`, `…/GraphEditor/Common/Model/GraphSaveData.cs`.

**Explicitly out of scope for this migration doc**

- **Graph / process editor** (window opened by `openGraphWindowBtn`, graph asset items, `ToolboxesMakerPopUp`, `OperationMakerPopUp`). **Exception:** file type **`.intraverse-graph`** is still listed in import tables so you know what Sketcher accepts OS-side. On web, **behavior = JavaScript modules** per interactive-gltf.
- **Factory / Dreamtime / addon marketplace**, login flows, full PLM/IOT connector surface (connector types are mentioned only where they affect import).
- **Embedded UMI3D EDK server** — described for UI parity; web POC may use **save + play manifest** only.

---

## 1. View model: primary zones

The editor is a single full-screen **`screen`** with a **vertical** layout:

1. **`toolbar`** — top menu strip (File, Settings, centered project path label).
2. **`windowContainer`** — main workspace:
   - **`toolbar2`** — tool modes, undo/redo, **`ServerToolElement`**, and (Sketcher) `openGraphWindowBtn` (omit on web).
   - **`mainDisplay`**:
     - **`mainTopDisplay`**: **`hierarchy`** | `hierarchyRightBorder` | **`preview`** ( **`previewHeader`** + **`previewViewport`** ) | **`inspector`**
     - **`assetsTopBorder`** — resizes asset strip height
     - **`assets`** — **`assetsLibraries`** | `assetsLibrariesRightBorder` | **`assetsTab`**
3. **`errorLog`** — status bar (warning icon, counts, last message).

**Focus flags:** `UIManager` uses `FocusViewport`, `FocusAssetsLibraries`, `FocusAssetsExplorer` to route shortcuts (e.g. rename). The web app should define an equivalent focus model.

---

## 2. Workspace layout & resizing

| Mechanism | UXML / code | Sketcher behavior | Web intent splitters |
|-----------|-------------|-------------------|----------------------|
| Hierarchy width | `hierarchyRightBorder` + `ResizableManipulator` | Resizes `hierarchy` vs `preview` | Vertical drag between tree and viewport |
| Inspector width | `inspectorLeftBorder` + `ResizableManipulator` | Resizes `inspector` vs `preview` | Vertical drag between viewport and inspector |
| Asset strip height | `assetsTopBorder` | Resizes `assets` vs `mainTopDisplay` | Horizontal drag between 3D stack and assets row |
| Libraries vs explorer | `assetsLibrariesRightBorder` | Resizes `assetsLibraries` vs `assetsTab` | Vertical drag in asset row |
| Explorer properties | `rightAssetsResizeArea` | UXML present; extra manipulator commented in `UIManager` | Optional width for asset “Properties” column |

---

## 3. File formats, OS drop, and drag-and-drop behavior

### 3.1 Where OS files enter the editor

When the **editor is open** and **no modal** blocks UI, `UnityDragAndDropHook.OnDroppedFiles` (see `ImportAssetPanel` constructor) forwards paths to `ImportAssetPanel.CheckFiles`. That builds a tree of `ImporterItem` rows and either:

> **Note:** In Sketcher this OS-level drop is **global to the editor window**, not restricted to the **`assetsTab`** panel. The **assets explorer** additionally supports **internal** drag-and-drop for items already in the project (`AssetsLibraryReorganization`). On the web, you may choose to accept OS drops only when the pointer is over the **asset** panel, or mirror Sketcher’s global behavior.

- opens **`localImportAssetsPopUp`** if at least one **3D / “locally loadable”** model is in the batch (`nbModels > 0`), or  
- calls **`ValidatePopUp()`** immediately if the batch has **no** such models (e.g. only “resource” files).

**`importAssetLibrary`** and **File → import** flows also call `ImportFiles` with the same pipeline.

**Target:** Default **directory** on disk is under **`Imported Asset/`** unless the user has a **writable folder** selected in the explorer whose path starts with `Imported Asset/` (see `ImportAssetPanel.ValidatePopUp`).

### 3.2 Extension classification (import pipeline)

Logic: `ImportAssetPanel.CheckFile` per file; **directory** nodes recurse. Summary:

| Extension(s) | Sketcher class (`RESOURCETYPE` / handling) | User sees in import UI | After confirm (`SketchAPI.ImportFiles` + side paths) |
|--------------|--------------------------------------------|------------------------|------------------------------------------------------|
| **`.glb`**, **`.gltf`** | TwinAsset (3D) | Row in import popup; per-row toggles | Loaded via `LocalGltfLoader` path (`LocalLibrary.CanLoadExtension`) |
| **`.obj`** | TwinAsset (3D) | Same | `LocalObjLoader` |
| **`.fbx`** | TwinAsset (3D) | Same | **Hard-coded** in `LocalLibrary.CanLoadExtension` in addition to loaders |
| **`.bundle`** | TwinAsset (3D) | Same | `LocalBundleLoader` (Unity asset bundle) |
| **`.multiobj`**, **`.multigltf`** | TwinAsset (3D) | Same | `LocalMultiObjectLoader` |
| **`.umi3dpose`** | **Pose** (if valid & unique name) or **Hidden** | Row; may be hidden if validation fails | Registered pose resource under `other` format folder |
| **`.intraverse-graph`** | Treated as graph file in **ValidatePopUp** | Row in list | **`ImportGraphAsync`** on graph controller (web: **omit or map to script asset**) |
| **Any other extension** | **Resource** if `!IsExtensionLocallyLoadable` | Row; “import as product” UI **hidden** for pure resources | Copied/stored as generic **Resource** (textures, etc.); `IsAVideoFile` flags video for downstream |

**Hidden / ignored in tree:** If extension does not match the branches above **and** is not “locally loadable” **and** is not `!LocallyLoadable` as resource — the `else` branch sets **`RESOURCETYPE.Hidden`** (still listed under a directory parent but not a first-class import).

**Video extensions** (flag only in `ImportFileInfo`, from `ImportAssetPanel.IsAVideoFile`):  
`mov`, `mp4`, `mpg`, `mpeg`, `asf`, `avi`, `dv`, `m4v`, `ogv`, `vp8`, `webm`, `wmv`.

**3D “update asset” popup** (`UpdateAssetsPopUp`): treats **`.obj`**, **`.glb`**, **`.gltf`**, **`.fbx`** as 3D models; **`.bundle`** separately as bundle — errors otherwise.

### 3.3 Per-row controls in the import popup (`dropAssetEntry` / `ImporterItem`)

Each imported file/folder row includes:

| Control (logical) | Description |
|-------------------|-------------|
| **`importAssetToggle`** | Include/exclude this row (and children recursively). Syncs with **`importAllAssetsToggle`**. |
| **`importAsProductToggle`** (rounded) | For Product / TwinAsset / Material types: import as **hierarchical product** vs **simple object** (labelled “Hierarchical” vs “Simple object” in the popup chrome). Bulk: **`importAllAssetsAsProductToggle`**. |
| **`formatInput`** (dropdown) | **Bundle / platform slot**: `default`, `android`, `ARandroid` (`ImporterItem.formats`). Applied recursively when parent folder sets format. |
| Folder **open/close** | Expands/collapses directory children in the scroll view. |

**Popup chrome buttons:**

| `name` | Label (UXML) | Action |
|--------|----------------|--------|
| **`closeLocalImportAssetsPopUp`** | (icon) | Closes popup; clears list; resets master toggles |
| **`validateLocalImportAssetsPopUp`** | “Import” | Runs `ValidatePopUp` → `SketchAPI.ImportFiles` + optional graph import |
| **`importAllAssetsToggle`** | — | Master: set all rows **wantToImport** |
| **`importAllAssetsAsProductToggle`** | — | Master: set **import as product** for eligible rows |

### 3.4 In-app drag-and-drop (`DragType` matrix)

Defined in `DragAndDropRuntime.DragType`. **Drop zone** must match exactly **one** drag type from the source.

| `DragType` | Typical source | Typical drop target in scene editor |
|------------|----------------|-------------------------------------|
| **`AssetsLibraryReorganization`** | Asset / folder in **libraries or explorer** | `assetsExplorer`, library container — reorder/move items |
| **`LoadModelInHierarchy`** | 3D asset from project | `hierarchyListView`, foldout row, `reorganizationBorder` — **instancing** |
| **`LoadModelInViewPort`** | 3D asset | `previewViewport` (**VR project only** in code: `onlyAvailableInVRProject`) |
| **`HierarchyReorganization`** | Hierarchy row | Another row / layer strip — reparent, reorder |
| **`DragAssetInput`** | Asset | Inspector **asset fields** (`InspectorAssetField`) |
| **`AddComponent`**, **`AddThing`**, **`AddGraph`** | Asset | Hierarchy foldouts / inspector (**AddGraph**: web omit) |
| **`AddComponentInInspector`** | Modifier | Inspector container (**VR-only** flag in code) |

**assetsTab specifically:** `assetsExplorer` registers **`DropManipulator(DragType.AssetsLibraryReorganization)`** — internal moves between folders / list, not OS file paths.

---

## 4. Exhaustive control catalog (`UI_DTM.uxml` + `contextualMenu.uxml`)

Every named **Button**, **Toggle**, major **TextField**, and **Label** used as status called out. *Graph-only* controls are marked **[graph – skip web]**.

### 4.1 `toolbar` (top)

| `name` | Type | Visible text / role | On click / behavior |
|--------|------|---------------------|---------------------|
| **`file`** | Button | “File” | Toggle **`fileMenu`** visibility; toggles **`toolbarButtonActive`** on self |
| **`settings`** | Button | “Settings” | Opens **`SettingsPopUp`** (`settingsPopup` root) |
| **`projectPath`** | Label | Dynamic | **Scene/project title path**; updated via `SetScenePathLabel` |

### 4.2 `fileMenu` (dropdown under `file`)

| `name` | Label child text | Shortcut label | Behavior |
|--------|------------------|----------------|----------|
| **`open`** | “Open..” | (dynamic) | Closes menu; if dirty → confirmation else **`OpenFile`** |
| **`save`** | “Save..” | Ctrl + S | Closes menu; **`Save()`** |
| **`saveAs`** | “Save As..” | Ctrl + Shift + S | Closes menu; **`Save(true)`** |
| **`exportToFactory`** | “Export To Factory..” | Ctrl + E | Closes menu; **`ExportToFactory()`** (hidden in non-factory mode) |
| **`saveLocal`** | “Local Export..” | Ctrl + Shift + E | Closes menu; **`SaveLocal()`** (shown in factory mode) |
| **`closeProject`** | “Close Project” | Ctrl + W | Closes menu; confirm if dirty; **`SketchAPI.CloseProject`** + **`CloseEditor`** |

### 4.3 `toolbar2` — tool buttons (`tools`)

| `name` | Tooltip | Behavior |
|--------|---------|----------|
| **`select`** | Select | **`ModeCursor.Select`**; deselects move/rotate/scale styling |
| **`undo`** | Undo | **`SketchAPI.Undo()`**; shows **`countUndo`** on **`orangeUndo`** / grey state |
| **`redo`** | Redo | **`SketchAPI.Redo()`**; **`countRedo`** |
| **`move`** | Transform | **`ModeCursor.Move`**; multigizmo icon **`moveImage`** |
| **`rotate`** | Rotate | `ModeCursor.Rotate` (UXML often `display: none`) |
| **`scale`** | Scale | `ModeCursor.Scale` (often hidden) |
| **`openGraphWindowBtn`** | Graph Editor | Opens **`IntraverseGraphWindow`** **[graph – skip web]** |

**`ServerToolElement` (`server-tool-main`)** — created in code, not UXML names from template except root:

| Logical control | Tooltip / text | Behavior |
|-----------------|----------------|----------|
| **`server-tool__server-play-not-possible-btn`** | — | Shown when server **cannot** start; **`PlayNotPossible`** handler |
| **`server-tool__server-play-btn`** | Play UMI3D Server | **`SketchAPI.LaunchUMI3D`** |
| **`server-tool__server-stop-btn`** | Stop UMI3D Server | **`SketchAPI.StopUMI3D`** |
| **`server-tool__server-settings-btn`** | UMI3D Server settings | Toggle **`ServerSettingsPopUp`** |

---

### 4.4 `hierarchy` — header & chrome

| `name` | Type | Behavior |
|--------|------|----------|
| **`hierarchyLabel`** | Label | Static title “Hierarchy” |
| **`searchHierarchyInput`** | TextField | Hidden until search toggled; **search on submit**; focuses register as “input modified” |
| **`searchHierarchy`** | Button | Toggles search field; clears **custom hierarchy** view when closing search |
| **`filterHierarchy`** | Button | **[UXML `display: none` — not used]** |
| **`currentLayerDisplayLabel`** | Label | Shows **“Scene”** or active **layer** name |
| **`layersButton`** | Button | Opens/closes **`layersSelectionMenu`** |
| **`hierarchyListView`** | ListView | Main tree; drop: **`LoadModelInHierarchy`**, **`HierarchyReorganization`** |
| **`customHierarchyListView`** | ListView | Search / filter results list |
| **`layerSelectionScene`** | Button | Entry **“Scene”** inside **`layersSelectionMenu`** |
| **`hierarchyBin`** | Button | **`OpenDeleteObjectsPopUp`** (delete selection) |

**Per-tree-row template (`hierarchySceneItem` clone):** labels and buttons wired in **`AssetGraphPanel` / `SceneGraphPanel`**, typically including **`exploreToggle`** (foldout), **`hideToggle`** (visibility), **`dataSourceButton`** (data source), **`itemName`**, **`itemChangeNameInput`** (rename inline).

---

### 4.5 `preview` — viewport header `views`

| `name` | Type / text | Behavior |
|--------|-------------|----------|
| **`gridMode`** | Button (grid icon) | Toggle **`Grid`** GameObject + **`viewButtonSelected`** class |
| **`left`**, **`right`**, **`top`**, **`bottom`**, **`front`**, **`rear`** | Buttons | **`CameraMovement.WandToAligneToView`** for ortho preset |
| **`focus`** | Button “Focus” | **`CameraMovement.WantToFocus`** (frame selection) |
| **`gizmoMode`** | Button | Toggle **Global / Local** gizmo space; label = **`GizmoManager.ModeToString()`** |
| **`gizmoCenter`** | Button | Toggle **Center / Pivot**; label = **`GizmoManager.CenterModeToString()`** |
| **`spacing`** | VisualElement | Dividers (non-interactive) |

**`previewViewport`**

- **Drop:** **`LoadModelInViewPort`** (VR-only flag).
- **Hover:** sets **`UIManager.IsMouseHoveringViewport`** for shortcuts.

---

### 4.6 `inspector`

**Header**

| `name` | Role |
|--------|------|
| **`inspectorLabel`** | “Inspector” title |
| **`inspectorContainer`** | Scroll region for foldouts |

**Selection title bar**

| `name` | Role |
|--------|------|
| **`inspectorInspectedLabel`** | Name(s) of selected object(s) |

**Foldout `inspectorProductProperties`**

| `name` | Type | Role |
|--------|------|------|
| **`propertiesSingleObjectProduct`** block | — | Single selection |
| **`productLabel`** | TextField | Editable **label** |
| **`modelPath`** | TextField | Read-only **model path** |
| **`connector`** | TextField | Read-only **connector** |
| **`propertiesMultiObjectProduct`** block | — | Multi selection |
| **`isIsolableProduct`** | Toggle | **Always visible** |
| **`isImmersiveOnlyProduct`** | Toggle | **VR Only** |
| **`traversableProduct`** | Toggle | **Traversable** |
| **`partOfNavMeshProduct`** | Toggle | **Part of Nav Mesh** |
| **`blockingInteractionProduct`** | Toggle | **Blocking Interaction Behind** |
| **`indicatorDisplayProduct`** | Toggle | **Display Indicator** |
| **`indicatorDeltaProductX/Y/Z`** | TextField | **Indicator delta** vector |

**Foldout `inspectorPartProperties`**

| `name` | Role |
|--------|------|
| **`partLabel`**, **`productId`**, **`modelPath`**, **`connector`** | Part identity fields (mostly read-only) |
| **`isIsolablePart`**, **`isImmersiveOnlyPart`**, **`traversablePart`**, **`partOfNavMeshPart`**, **`blockingInteractionPart`**, **`indicatorDisplayPart`**, **`indicatorDeltaPartX/Y/Z`** | Multi-edit toggles & delta |

**Foldout `inspectorTransformV2`**

| `name` | Role |
|--------|------|
| **`transformPosX/Y/Z`** | Position |
| **`transformRotX/Y/Z`** | Rotation (Euler in UI) |
| **`transformScaleX/Y/Z`** | Scale |
| **`transformWarning`** | Shown when transform driven by modifier |

**Foldout `inspectorIOT`**

| `name` | Role |
|--------|------|
| **`inspectorIOTThings`**, **`inspectorIOTDisplays`**, **`inspectorIOTParts`** | IoT sub-sections (mostly Sketcher-specific) |

**Footer**

| `name` | Role |
|--------|------|
| **`inspectorFooter`** | Container (often **display none** on bind); holds **`bin`** |
| **`bin`** | Delete selection / component (confirmation popups) |

---

### 4.7 `assets` — `assetsLibraries` column

**Header**

| `name` | Role |
|--------|------|
| **`assetsLibrariesLabel`** | “Assets” |
| **`searchAssetsLibrariesInput`** | Search filter for library tree |
| **`searchAssetsLibraries`** | Triggers / accompanies search |
| **`filterAssetsLibraries`** | Hidden in UXML |

**Body**

| `name` | Role |
|--------|------|
| **`assetsLibrariesContainer`** | Scroll: hierarchy + optional PLM/IOT/Models foldouts (mostly **`display: none`**) |
| **`assetsLibrariesHierarchyContainer`** | Root mount for **`FolderItem`** tree |
| **`assetsLibrariesResearchContainer`** | Alternate search results |

**Footer**

| `name` | Tooltip | Role |
|--------|---------|------|
| **`binLibrary`** | Delete | **`OpenDeleteObjectsPopUp`** for library selection |
| **`addLibrary`** | Add connector | **`AddConnectorPopUp`** |
| **`addAddonLibrary`** | Import add-on | **`AddAddonPopUp`** |
| **`importAssetLibrary`** | Import resources | OS file picker → **`importAssetPanel.ImportFiles`** |
| **`modifyLibrary`** | — | **[hidden]** |
| **`addFolderLibrary`** | Add new folder | **`AddNewFolder`** in **`AssetsPanel`** |

---

### 4.8 `assets` — `assetsTab` (explorer + properties)

**Header**

| `name` | Role |
|--------|------|
| **`assetsExplorerPath`** | Breadcrumb; contains **`pathExplorerBtn`** instances |
| **`searchAssetsExplorerInput`** | Filter in folder |
| **`searchAssetsExplorer`** | Search trigger |
| **`filterAssets`**, **`listAssetsDisplay`**, **`thumbnailAssetsDisplay`** | Often hidden; list vs thumbnail, filter |

**Main**

| `name` | Role |
|--------|------|
| **`assetsExplorer`** | **`DropManipulator(AssetsLibraryReorganization)`**; LMB deselect; RMB **context menu** + dynamic “Create SO …”, **Create folder**, **Create graph [skip web]** |
| **`assetsExplorerContainerViewThumbnails`** | Thumbnail grid **`ScrollView`** |
| **`assetsExplorerContainerViewList`** | List **`ScrollView`** |

**Right column `assetsProperties`**

| `name` | Role |
|--------|------|
| **`assetsPropertiesLabel`** | “Properties” |
| **`propertiesPreview`** | Square **preview** |
| **`propertiesName`**, **`propertiesFileType`**, **`propertiesConnector`** | Labels for selection |

---

### 4.9 `errorLog`

| `name` | Role |
|--------|------|
| **`errorWarning`** | Warning icon |
| **`errorLoop`** | Button showing **error count** |
| **`error`** | Button / label line: **last error message** |

---

### 4.10 `mainLoadingScreen` (global)

| `name` | Role |
|--------|------|
| **`mainLoadingScreenInfo`** | Progress text / percent |
| **`mainLoadingScreenCancel`** | **`SketchAPI.CancelLoading`** when allowed |
| **`logo`**, **`inverted_logo`** | Branding animation |

---

### 4.11 `contextualMenu` (`contextualMenu.uxml`)

| `name` | Text | Notes |
|--------|------|-------|
| **`customButtonsContainer`** | — | Hosts **dynamic** entries (e.g. “Create SO …”, graph) |
| **`renameBtn`** | Rename | Enabled when **renaming** allowed; **F2** hint |
| **`newBtn`** | New Empty | **`SketchAPI.CreateNewAsset`** |
| **`selectChildrenBtn`** | Select Children | Adds all descendants to selection |
| **`isolateBtn`** | Isolate / Unisolate | **`SketchAPI.ToogleIsolate`**; **Ctrl+I** |
| **`copyBtn`** | Copy | **Hidden in practice; handler empty** |
| **`cutBtn`** | Cut | **Hidden; empty** |
| **`pastBtn`** | Past | **Hidden; empty** |
| **`duplicateBtn`** | Duplicate | **`SketchAPI.DuplicateAssets`**; **Ctrl+D** |
| **`delBtn`** | Delete | Opens delete flow |
| **`updateDownloadedBtn`** | Update | For **DownloadableProductItem** |
| **`deleteDownloadedBtn`** | Delete Downloaded | Removes downloaded product items |
| **`updateAssetdBtn`** | Update Asset | Opens **`UpdateAssetsPopUp`** for **ResourceItem** selection |

**Separate menu modes:** **viewport/hierarchy** vs **asset library** vs **asset explorer** — see `ContextualMenu.OpenMenu`, `OpenAssetLibraryMenu`, `OpenAssetExplorerMenu` for which rows are visible.

---

### 4.12 Other scene-editor popups partially defined in `UI_DTM.uxml`

(Only controls that appear in the same document.)

| Root `name` | Notable buttons | Role |
|-------------|-----------------|------|
| **`localImportAssetsPopUp`** | §3.3 | Batch import |
| **`inspectorDeleteModifierPopup`** | **`inspectorDeleteYes`**, **`inspectorDeleteNo`**, **`closeDeletePopUp`** | Confirm remove modifier |
| **`inspectorDeleteObjectPopup`** | (similar pattern) | Confirm delete object |
| **`settingsDTMPopUp`** | **`closeSettingsDTMPopUp`**, port/name fields | **UMI3D server** HTTP / LAN |
| **`addAssetsLibraryPopUp`** | **`addAssetsLibraryCancel`**, **`Clear`**, **`Add`**, **`connectorTypeOpenBtn`** | New connector |
| **`inspectorSimplePopup`** | — | Generic message |
| **`errorPopUp`** | — | Error surface |

---

## 5. Migration decisions (Back / Front) by area

### 5.1 File menu & project

**Back:** Project vs **glb+js** bundle; REST save contract; merge rules; auth later.

**Front:** Dirty indicator; download vs server save; unsaved guard.

### 5.2 Tools, undo/redo, server

**Back:** Replace UMI3D server with publish/play URL?; undo stack on server vs client.

**Front:** Gizmo library; rotate/scale vs unified tool; undo coalescing.

### 5.3 Hierarchy & layers

**Back:** Scene graph API; layers in glTF; reparent PATCH.

**Front:** Virtualized tree; DnD UX; search strategy.

### 5.4 Viewport

**Back:** TRS authority; re-export policy.

**Front:** Camera presets; grid/snapping; picking.

### 5.5 Inspector & “components”

**Back:** Map UMI3D flags to interactive-gltf; JSON Schema for script params.

**Front:** Dynamic forms; multi-edit; Euler vs quaternion.

### 5.6 Assets libraries & explorer

**Back:** Allowed MIME list; thumbnails server vs client; folder layout.

**Front:** Upload progress; list/grid virtualization.

### 5.7 Import / formats

**Back:** Which Sketcher formats to support (likely **glTF-first**); conversion service for `.fbx`/`.obj` or reject; **no `.bundle`** on web.

**Front:** Same **import review** dialog as Sketcher vs immediate upload; how to show **`default/android/ARandroid`** if ever needed.

### 5.8 Context menus & clipboard

**Back:** Duplicate / paste semantics; ids.

**Front:** Implement **copy/cut/paste** if desired (currently stubbed in Sketcher).

### 5.9 Shortcuts

**Back:** Idempotent APIs.

**Front:** Central registry; avoid Ctrl+W browser close.

---

## 6. Cross-cutting decisions

**Back:** Source of truth (glTF + sidecars); validation gates; permissions.

**Front:** State management; **a11y** on splitters and tree; design system vs Sketcher chrome.

---

## 7. Suggested phased delivery

1. Layout shell + splitters + focus model.
2. Viewport + glTF + selection + transform + camera + grid.
3. Hierarchy + DnD from a minimal asset list.
4. Inspector: transform + labels.
5. Import pipeline: **glb/gltf/js** first; expand table from §3.2 as needed.
6. Undo/redo + context menus + shortcuts.
7. Script attach UI (replaces graph **[graph – skip web]** flows).

---

*Document generated from Sketcher sources under `UMI3D-Sketcher-no-history-2.11` (read-only). Update as the interactive-gltf engine POC scope changes.*
