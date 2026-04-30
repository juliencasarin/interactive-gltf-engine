# Phase 1 — Sketcher scene editor: reverse-engineered user stories

This document is the **Phase 1** deliverable for migrating **UMI3D Sketcher** (Unity UI Toolkit) to **`igltf-editor-frontend`**. It lists **implementable user stories** with acceptance criteria and priorities. **UI must stay faithful to Sketcher** unless a written decision says otherwise (see **Design contract**).

**References (read-only):**

- Inventory: [`igltf-editor-frontend/migration.md`](../../igltf-editor-frontend/migration.md)
- Skill: [`.cursor/skills/migrate-sketcher-feature/SKILL.md`](../../.cursor/skills/migrate-sketcher-feature/SKILL.md)
- Layout & inline styles: Sketcher `Intraverse/Assets/Scripts/UI/UXML/UI_DTM.uxml`
- Shared styles: `…/UXML/Resources/Style/UI_DTM.uss` (e.g. `:root` **12px**, **Arial Unicode**; **divisionHeader** `rgb(111,111,112)`; toolbar tool sizing)

**Story IDs:** `US-SK-###` — implement **one ID (or a declared cluster)** per migration iteration.

**Priority:** **P0** MVP parity shell, **P1** authoring depth, **P2** optional / polish / Unity-only parity.

---

## Design contract (Sketcher fidelity)

For every implemented story:

1. **Layout** matches **`UI_DTM.uxml`** region order: `toolbar` → `toolbar2` → `mainTopDisplay` (hierarchy | preview | inspector) → `assetsTopBorder` → `assets` → `errorLog`.
2. **Default sizing** follows UXML where applicable: e.g. hierarchy **min-width 10%** / **width 268px**, inspector **width 231px**, assets row **height ~22%** (`min-height 20%`), toolbar **29px** / second bar **41px**.
3. **Colors & type** follow **UXML inline** + **`UI_DTM.uss`** (e.g. toolbar `rgb(29,29,29)`, accent text `rgba(255,170,42,0.95)`, panel grays `rgb(52,52,52)` / `rgb(56,56,56)` per migration doc).
4. **Splitters** are **3px** dark bars (`rgb(36,36,36)`) as in Sketcher, draggable behavior per `migration.md` §2.
5. Deviations require a **Decision log** entry (Phase 3 of the skill).

Phase **2** of the skill can extract a pixel-perfect token sheet; this Phase 1 doc **binds** implementation to Sketcher sources above.

---

## SKIP — Out of scope for web (keep in backlog with label)

| ID | Topic | Reason |
|----|--------|--------|
| **SKIP-01** | **`openGraphWindowBtn`** / Intraverse graph window / `.intraverse-graph` import | Replaced by **JS behavior modules** (interactive-gltf); no node graph. |
| **SKIP-02** | **UMI3D EDK server** play/stop + **`ServerSettingsPopUp`** | Unity-embedded server; web uses **save + play manifest** unless product decides otherwise. |
| **SKIP-03** | **`LoadModelInViewPort`** VR-only drop | Unity VR pipeline. |
| **SKIP-04** | **Factory / Dreamtime** (`exportToFactory`, `saveLocal` when factory), login, addon marketplace | Product not in POC scope. |
| **SKIP-05** | **`.bundle`** (Unity AssetBundle) local loader | Browser cannot load Unity bundles natively. |
| **SKIP-06** | **Copy / Cut / Paste** in `ContextualMenu` | Handlers **empty** in Sketcher; do not copy “non-behavior”. Optional future **P2** if product wants real clipboard. |
| **SKIP-07** | Full **PLM / connector** catalog (`addLibrary`, `AddConnectorPopUp`) | Defer; POC may use **upload-only** asset root. |
| **SKIP-08** | Full **IoT** inspector foldouts (`inspectorIOT*`) | Sketcher-specific; map to **P2** or omit until spec. |

---

## Epic A — Editor shell & workspace chrome

### US-SK-001 — Editor layout regions (P0)

**As an** author, **I want** the editor divided into hierarchy, 3D preview, inspector, and bottom assets strip **so that** I can navigate the scene like in Sketcher.

**Acceptance criteria**

- [ ] Regions appear in the same **spatial order** as Sketcher (`migration.md` §1).
- [ ] **Toolbar** height and **second toolbar** height match UXML (**29px** / **41px**).
- [ ] **Asset strip** uses **flex** constraints equivalent to **~22% height**, **min 20%**, **flex-grow 0** on `assets`.
- [ ] **Design contract** §1–3 satisfied for background colors of main panels.

---

### US-SK-002 — Resizable splitters (P0)

**As an** author, **I want** to drag splitters between hierarchy, viewport, inspector, asset row, and library/explorer **so that** I can adjust workspace width like Sketcher.

**Acceptance criteria**

- [ ] **Hierarchy ↔ preview**: vertical splitter (**3px**, `rgb(36,36,36)`).
- [ ] **Inspector ↔ preview**: vertical splitter on inspector **left** edge.
- [ ] **3D stack ↔ assets**: horizontal splitter on **`assetsTopBorder`**.
- [ ] **Assets library ↔ explorer**: vertical splitter (**3px**).
- [ ] Drag updates layout without breaking **min-width 10%** rules from UXML where applicable.

---

### US-SK-003 — Focus model for panels (P1)

**As an** author, **I want** the app to know whether my “focus” is viewport, asset libraries, or asset explorer **so that** shortcuts (e.g. rename) target the correct context like Sketcher.

**Acceptance criteria**

- [ ] Three logical focus targets exist (or documented merge if simplified).
- [ ] Clicking inside a panel sets focus **without** opening modals.
- [ ] Behavior matches `UIManager` focus flags where stories reference shortcuts.

---

### US-SK-004 — Project path label (P0)

**As an** author, **I want** to see the current document path/title centered in the top bar **so that** I know what I am editing.

**Acceptance criteria**

- [ ] Label visually centered in **`toolbar`** (Sketch uses absolute centered `projectPath`).
- [ ] Dirty state reflected in title if applicable (e.g. `*` suffix convention aligned with Sketcher or decision log).

---

## Epic B — Menu, settings, project lifecycle

### US-SK-010 — File menu (P0 subset)

**As an** author, **I want** **File** to open a dropdown with Open, Save, Save As, Close project **so that** I can manage documents.

**Acceptance criteria**

- [ ] **File** toggles menu; active state **`toolbarButtonActive`** styling (orange accent per Sketcher).
- [ ] **Open / Save / Save As / Close** wired; **unsaved** guard before destructive actions.
- [ ] Menu items show **shortcut hints** where applicable (Save `Ctrl+S`, Save As `Ctrl+Shift+S`, Close `Ctrl+W`).
- [ ] **exportToFactory / saveLocal** hidden unless product enables “factory” mode (**SKIP-04** default).

---

### US-SK-011 — Settings entry (P1)

**As an** author, **I want** **Settings** to open application settings **so that** I can adjust editor behavior.

**Acceptance criteria**

- [ ] **Settings** opens a panel/modal analogous to `SettingsPopUp`.
- [ ] Content may be **subset** for web; gaps listed in Decision log.

---

### US-SK-012 — Keyboard: file & project (P0)

**As an** author, **I want** Ctrl+S, Ctrl+Shift+S, Ctrl+W to trigger save / save as / close **so that** I work efficiently.

**Acceptance criteria**

- [ ] Shortcuts match `ShortcutInputManager` / file menu when no text field steals focus.
- [ ] Browser conflicts (Ctrl+W) documented with **mitigation** in Decision log.

---

## Epic C — Tools toolbar (selection, undo, transform)

### US-SK-020 — Select tool (P0)

**As an** author, **I want** to activate **Select** mode **so that** I pick objects without transforming.

**Acceptance criteria**

- [ ] **select** shows selected state **`toolbarToolSelected`**.
- [ ] Cursor / picking uses select mode in viewport.

---

### US-SK-021 — Move / rotate / scale tools (P0 / P1)

**As an** author, **I want** transform tools **so that** I manipulate objects in the viewport.

**Acceptance criteria**

- [ ] **move** (Transform) toggles gizmo translate (P0).
- [ ] **rotate** / **scale** available: either visible buttons **or** unified gizmo covering R/S (match Sketcher default UXML: rotate/scale often `display:none` → **P1** to expose if desired).
- [ ] **Tooltips** “Select”, “Transform”, “Rotate”, “Scale” like Sketcher.

---

### US-SK-022 — Undo / redo (P1)

**As an** author, **I want** undo and redo with visible stack depth **so that** I can correct edits.

**Acceptance criteria**

- [ ] Buttons **undo** / **redo** call undo stack.
- [ ] **countUndo** / **countRedo** labels update; **orange** vs **greyed** icons match state.
- [ ] Undo still works per Sketcher when **input fields** are not focused (see ShortcutInputManager rules).

---

### US-SK-023 — Keyboard: transform tools (P1)

**As an** author, **I want** keyboard shortcuts to switch select / move **so that** I match Sketcher power-user flow.

**Acceptance criteria**

- [ ] `ToolPanelShortcuts` parity (`InputManager` keys mirrored on web).

---

## Epic D — Hierarchy

### US-SK-030 — Scene tree display (P0)

**As an** author, **I want** a scrollable hierarchy listing scene nodes **so that** I understand parent/child structure.

**Acceptance criteria**

- [ ] List mirrors scene graph order semantics (as defined by web scene model).
- [ ] Row height ~**22–25px** feel (ListView `fixed-item-height` 25 in UXML).
- [ ] **divisionHeader** styling for “Hierarchy” row (**24px**, header color per contract).

---

### US-SK-031 — Hierarchy search (P1)

**As an** author, **I want** to toggle search and filter the hierarchy **so that** I find nodes quickly.

**Acceptance criteria**

- [ ] **searchHierarchy** toggles **searchHierarchyInput**.
- [ ] Submit triggers search; closing search clears **custom** result list and restores full tree.
- [ ] Strategies: at least **by name**; **by component / operation** if parity required (**P2** partial OK with decision).

---

### US-SK-032 — Layers strip (P1)

**As an** author, **I want** to switch layers and see **Scene** vs layer name **so that** I organize content like Sketcher.

**Acceptance criteria**

- [ ] **currentLayerDisplayLabel** shows active context.
- [ ] **layersButton** toggles **layersSelectionMenu**; **layerSelectionScene** selects root scene.
- [ ] Drop on layer header supports **HierarchyReorganization** if product keeps layers.

---

### US-SK-033 — Hierarchy drag-and-drop (P1)

**As an** author, **I want** to reparent/reorder nodes and drop assets into the hierarchy **so that** I assemble the scene.

**Acceptance criteria**

- [ ] **HierarchyReorganization** parity for internal moves.
- [ ] **LoadModelInHierarchy** from project asset onto valid target.
- [ ] Auto-expand / highlight behavior acceptable vs Sketcher (note deltas in Decision log).

---

### US-SK-034 — Hierarchy delete & context menu (P1)

**As an** author, **I want** delete and context actions on hierarchy **so that** I manage nodes.

**Acceptance criteria**

- [ ] **hierarchyBin** opens delete confirmation flow.
- [ ] RMB: **Rename**, **New Empty**, **Select Children**, **Isolate/Unisolate**, **Duplicate**, **Delete** when applicable (see `contextualMenu.uxml`).
- [ ] **F2** rename when focus allows.

---

### US-SK-035 — Tree row controls (P1)

**As an** author, **I want** foldout, visibility, and optional data-source affordances per row **so that** I control items like Sketcher.

**Acceptance criteria**

- [ ] **exploreToggle** expands/collapses children.
- [ ] **hideToggle** toggles visibility.
- [ ] **dataSourceButton** present **if** product keeps data sources; else **Decision log** defer.

---

## Epic E — Viewport (3D preview)

### US-SK-040 — 3D view & hover focus (P0)

**As an** author, **I want** a large central 3D preview **so that** I see the scene.

**Acceptance criteria**

- [ ] **previewViewport** fills flex region under **previewHeader**.
- [ ] Mouse enter/leave sets “viewport hover” for shortcut routing (US-SK-003).

---

### US-SK-041 — Grid toggle (P1)

**As an** author, **I want** to toggle the grid **so that** I can align content.

**Acceptance criteria**

- [ ] **gridMode** toggles grid visibility and **viewButtonSelected** state.

---

### US-SK-042 — Orthographic view presets (P1)

**As an** author, **I want** Left/Right/Top/Bottom/Front/Rear buttons **so that** I snap the camera like Sketcher.

**Acceptance criteria**

- [ ] Six buttons align camera to labeled views.
- [ ] Selected view shows **viewButtonSelected**.

---

### US-SK-043 — Focus selection (P1)

**As an** author, **I want** **Focus** to frame the selection **so that** I quickly find selected objects.

**Acceptance criteria**

- [ ] **focus** button frames selection in camera.

---

### US-SK-044 — Gizmo local/global & pivot/center (P1)

**As an** author, **I want** **gizmoMode** and **gizmoCenter** toggles **so that** transforms behave predictably.

**Acceptance criteria**

- [ ] Buttons cycle **Global/Local** and **Center/Pivot**; labels reflect mode string like `GizmoManager`.

---

### US-SK-045 — Viewport pick & gizmo manipulation (P0)

**As an** author, **I want** to select objects in the viewport and move them with the gizmo **so that** I author transforms.

**Acceptance criteria**

- [ ] Picking selects scene node; gizmo updates TRS.
- [ ] Changes propagate to inspector fields (US-SK-050 cluster).

---

## Epic F — Inspector

### US-SK-050 — Selection header (P0)

**As an** author, **I want** the inspector to show what is selected **so that** I know the edit target.

**Acceptance criteria**

- [ ] **inspectorInspectedLabel** updates on selection change / multi-select label pattern.

---

### US-SK-051 — Transform foldout (P0)

**As an** author, **I want** position, rotation, scale fields **so that** I edit TRS numerically.

**Acceptance criteria**

- [ ] **transformPos/Rot/Scale** X/Y/Z fields; committed edits apply to selection.
- [ ] **transformWarning** shown when values are driven (modifiers / scripts) if applicable.

---

### US-SK-052 — Product properties (P1)

**As an** author, **I want** product label/path/connector fields and multi-edit toggles **so that** I match Sketcher property sets.

**Acceptance criteria**

- [ ] Single vs multi layouts (`propertiesSingleObjectProduct` vs `propertiesMultiObjectProduct`).
- [ ] Toggles: isolable/always visible, VR only, traversable, nav mesh, blocking interaction, indicator + delta.
- [ ] Field mapping to **interactive-gltf** may subset UMI3D flags — document in Decision log.

---

### US-SK-053 — Part properties (P1)

**As an** author, **I want** part identity fields and multi toggles **so that** I edit sub-objects.

**Acceptance criteria**

- [ ] Read-only **partLabel**, **productId**, **modelPath**, **connector** where applicable.
- [ ] Multi toggles mirror product set for parts.

---

### US-SK-054 — Inspector delete (P1)

**As an** author, **I want** to delete from inspector **so that** I remove components/objects.

**Acceptance criteria**

- [ ] **bin** triggers confirmation popups analogous to Sketcher.

---

### US-SK-055 — IoT foldout (P2 / optional)

**As an** author, **I want** IoT sections **only if** product requires them.

**Acceptance criteria**

- [ ] Default: **hidden** or placeholder; tie to **SKIP-08** until spec exists.

---

## Epic G — Assets library & explorer

### US-SK-060 — Library tree (P0 subset)

**As an** author, **I want** a left **Assets** tree rooted at “Project” **so that** I browse imported files.

**Acceptance criteria**

- [ ] **assetsLibrariesLabel** “Assets”; scroll region **assetsLibrariesContainer**.
- [ ] POC may flatten connectors to **folders** only; parity expansion **P1**.

---

### US-SK-061 — Library footer actions (P1)

**As an** author, **I want** import, new folder, and delete in the library footer **so that** I manage files.

**Acceptance criteria**

- [ ] **importAssetLibrary** opens file picker → import pipeline.
- [ ] **addFolderLibrary** creates folder.
- [ ] **binLibrary** deletes selection with confirmation.
- [ ] **addLibrary** / **addAddonLibrary**: **SKIP-07** / **SKIP-04** unless enabled.

---

### US-SK-062 — Asset explorer & breadcrumb (P1)

**As an** author, **I want** breadcrumbs and a grid/list of current folder **so that** I navigate project files.

**Acceptance criteria**

- [ ] **assetsExplorerPath** with clickable segments (**pathExplorerBtn**).
- [ ] **thumbnail** vs **list** toggle if shown (UXML often hides; **P2**).
- [ ] **searchAssetsExplorer** filters folder content.

---

### US-SK-063 — Asset selection & properties column (P1)

**As an** author, **I want** preview + name + type + connector labels **so that** I inspect assets.

**Acceptance criteria**

- [ ] **propertiesPreview**, **propertiesName**, **propertiesFileType**, **propertiesConnector** update with selection.

---

### US-SK-064 — Internal asset DnD (P1)

**As an** author, **I want** to reorganize assets inside the explorer **so that** folders reflect my structure.

**Acceptance criteria**

- [ ] **AssetsLibraryReorganization** parity for drag between folders / list.

---

### US-SK-065 — Asset explorer context menu (P1)

**As an** author, **I want** RMB menu on explorer **so that** I rename, delete, create folder, update assets.

**Acceptance criteria**

- [ ] **Rename**, **Delete**; **Update Asset** for resources when applicable.
- [ ] **Create graph** → replace with **Attach script** or omit per **SKIP-01**.
- [ ] Dynamic “Create SO …” entries → map to web **material/script** creation or **P2**.

---

## Epic H — Import pipeline (OS files)

### US-SK-070 — OS drop when editor open (P0)

**As an** author, **I want** to drop files into the editor **so that** I import assets like Sketcher.

**Acceptance criteria**

- [ ] Default: behavior matches Sketcher **global** window drop **or** decision to restrict drop zone documented.
- [ ] If no modal open, drop feeds **import** pipeline (not silently ignored).

---

### US-SK-071 — Import review popup (P0 subset)

**As an** author, **I want** a review dialog when the batch contains **3D loadable** models **so that** I confirm import options.

**Acceptance criteria**

- [ ] **importAllAssetsToggle** / **importAllAssetsAsProductToggle** master toggles.
- [ ] Per-row include + “import as product” + **format** `default|android|ARandroid` when product needs it.
- [ ] **Import** validates and runs pipeline; **close** resets state.
- [ ] Batches with **no** 3D models: **auto-import** path like Sketcher (`ValidatePopUp` immediate).

---

### US-SK-072 — Format support matrix (P0 / P1)

**As an** author, **I want** glTF assets supported; other formats per product **so that** we align with web constraints.

**Acceptance criteria**

- [ ] **.glb** / **.gltf** supported (P0).
- [ ] **.obj** / **.fbx**: **P1** via conversion service **or** reject with clear UX — **Decision log** required.
- [ ] **.bundle**, **.multiobj**, **.multigltf**, **.umi3dpose**: **P2** or **SKIP** with reason.
- [ ] **Resources** (textures, videos per list in `migration.md` §3.2): **P1** as needed.

---

### US-SK-073 — Drop asset onto hierarchy / inspector fields (P1)

**As an** author, **I want** DnD from assets to hierarchy/inspector targets **so that** I assign assets quickly.

**Acceptance criteria**

- [ ] **LoadModelInHierarchy** / **DragAssetInput** parity for supported targets.

---

## Epic I — Global UX: loading, errors, locking

### US-SK-080 — Loading screen (P1)

**As an** author, **I want** a blocking loading view with message and optional cancel **so that** long tasks are visible.

**Acceptance criteria**

- [ ] **mainLoadingScreen** analog: **mainLoadingScreenInfo**, cancel when allowed.
- [ ] Logo animation optional **P2**.

---

### US-SK-081 — Error bar (P1)

**As an** author, **I want** a bottom status strip with error count and message **so that** I see failures.

**Acceptance criteria**

- [ ] **errorWarning**, **errorLoop**, **error** behavior; click opens detail (console) **P2**.

---

### US-SK-082 — Screen locker (P2)

**As an** author, **I want** input blocked when a modal requires attention **so that** I cannot corrupt state.

**Acceptance criteria**

- [ ] **screenLocker** equivalent during critical flows.

---

## Epic J — Shortcuts & global actions

### US-SK-090 — Selection shortcuts (P1)

**As an** author, **I want** Ctrl+A and Escape to select all / clear selection **so that** navigation matches Sketcher.

**Acceptance criteria**

- [ ] Work when focus is hierarchy or viewport per Sketcher rules.

---

### US-SK-091 — Delete / duplicate (P1)

**As an** author, **I want** Del and Ctrl+D **so that** I remove or clone objects.

**Acceptance criteria**

- [ ] Delete opens confirmation when Sketcher does; duplicate clones assets.

---

### US-SK-092 — Isolate (P2)

**As an** author, **I want** Ctrl+I isolate toggle **so that** I focus hidden geometry.

**Acceptance criteria**

- [ ] Matches **isolateBtn** behavior and label **Unisolate** when active.

---

## Suggested implementation waves (after Phase 3 decisions)

| Wave | Stories | Note |
|------|---------|------|
| **W1** | US-SK-001, 002, 004, 040, 045, 050, 051, 070, 072 (glTF only), 010 (minimal save/open) | Shell + viewport + minimal inspector + glTF import |
| **W2** | US-SK-030, 033, 034, 020–021, 041–044, 060–063 | Hierarchy + camera + assets UI |
| **W3** | US-SK-022, 031, 032, 035, 052–054, 061, 064–065, 071, 073 | Depth + DnD + import review |
| **W4** | US-SK-011, 012, 023, 080–081, 090–092, 003 | Settings, shortcuts, polish |

Adjust waves after **Decision log** (backend save shape, formats, OS drop scope).

---

## Phase 1 completion checklist

- [ ] Every **non-SKIP** Sketcher surface in `migration.md` §4 maps to at least one **US-SK-###** or is explicitly deferred with priority.
- [ ] **Design contract** referenced for all UI stories.
- [ ] **SKIP** table reviewed with product — no accidental omission of required POC scope.
- [ ] Next step: run **Phase 2** of `migrate-sketcher-feature` (exact tokens) then **Phase 3** questions before coding **W1**.

---

*Generated for interactive-gltf-engine. Sketcher sources remain read-only.*
