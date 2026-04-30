---
name: migrate-sketcher-feature
description: >-
  Migrates a feature from UMI3D Sketcher (Unity) to the web igltf-editor by
  reverse-engineering user stories and UI from read-only Sketcher sources,
  eliciting developer decisions, implementing stories incrementally, and verifying
  parity and cross-story coherence. Use when the user ports Sketcher editor
  behavior or UI to interactive-gltf-engine (especially igltf-editor-frontend),
  or says migrate Sketcher, parity with Sketcher, or Sketcher user story.
---

# Migrate a Sketcher feature to the web editor

Use this skill when **porting** something from **UMI3D Sketcher** (Intraverse Unity project) into **`interactive-gltf-engine`** (React/FastAPI/etc.). Work **in the order below**; do not skip steps unless the user explicitly narrows scope.

## Hard constraints

- **Sketcher tree is read-only.** Paths such as `UMI3D-Sketcher-no-history-2.11/` (or any Sketcher root in the workspace) MUST NOT be edited, created, deleted, or refactored. Only **read** UXML, USS, and C# for reverse engineering.
- **Record deliberate deviations.** Anything the developer chooses not to match (e.g. no UMI3D server, no graph editor) must be written down so parity checks exclude those items.
- **Prefer existing inventory.** Start from **`igltf-editor-frontend/migration.md`** in this repo when it already covers the area; extend it rather than duplicating blindly.

## Outputs (what to produce or update)

| Phase | Primary output |
|-------|----------------|
| User stories | Canonical list: **`docs/sketcher-migration/phase1-user-stories.md`** (maintain per-feature addenda under `docs/sketcher-migration/` if needed) |
| UI design | Structured notes: layout tree, sizes, colors, typography, responsive/splitter behavior — or a Figma-free spec in Markdown |
| Decisions | A **Decision log**: question → chosen answer → date/owner (short) |
| Implementation | Code in `interactive-gltf-engine` only |
| Verification | Checklists tied to story IDs; coherence review |

---

## Phase 1 — Reverse engineering: user stories implemented in Sketcher

**Goal:** List **user-facing** behaviors as **implementable user stories** (independent, testable), not as file names.

**Method:**

1. Identify the **feature boundary** with the user (e.g. “asset import popup”, “hierarchy search”, “viewport grid”).
2. Trace **UI entry points**: UXML `name`/`UI_DTM.uxml`, bindings in `UIManager`, `InspectorPanel`, `AssetsPanel`, `ContextualMenu`, popups, `ShortcutInputManager`.
3. Trace **domain/API** behavior: `SketchAPI`, `PlayAPI`, `DragAndDropRuntime`, loaders under `Connector/`, relevant `AbstractAsset` / scene classes.
4. For each behavior, write stories in the form:  
   **As a [author], I want [action] so that [outcome]**, plus **acceptance criteria** (Given/When/Then or bullet checklist).
5. Tag stories **P0/P1/P2** if the scope is large.
6. Mark stories **out of scope for web** when they depend on Unity-only or product choices (EDK server, Unity bundles, graph editor) — keep them in the list with label **SKIP (reason)**.

**Done when:** The team agrees a story list covers Sketcher behavior for this feature with no hidden paths (keyboard shortcut, context menu, empty stub).

---

## Phase 2 — Reverse engineering: exact UI design (disposition, sizing, color)

**Goal:** Capture **layout and visual spec** so the web UI can match Sketcher unless a decision says otherwise.

**Method:**

1. **Layout tree:** Map **VisualElement** hierarchy from the relevant **UXML** (and parent templates). Note `flex-direction`, `flex-grow`, `width`, `min-width`, `height`, `min-height`, `%` heights (e.g. assets strip ~22%).
2. **Sizing:** Extract inline `style` and shared **USS** (`*.uss` referenced by UXML). Record **splitter** borders (`hierarchyRightBorder`, `assetsTopBorder`, etc.) and default panel widths from UXML (e.g. hierarchy `268px`, inspector `231px`).
3. **Colors:** List **rgb()/rgba()** and class-driven colors from USS (toolbar `#1d1d1d`, secondary bars, scroll backgrounds, `divisionHeader`, buttons).
4. **Typography:** Font assets (e.g. Arial Unicode), `font-size`, `-unity-text-align`, label colors (`#ffffff`, `#cccccc`, accent orange if used).
5. **Controls:** For each interactive control in scope, note **tooltip**, **icon** (sprite reference), **visible/hidden** defaults (`display: none`).
6. **States:** Selected tool class (`toolbarToolSelected`), view button selected, disabled/greyed undo-redo, focus/hover if defined in USS.

**Output format:** Prefer a single Markdown section **per feature** with subsections **Layout**, **Tokens (colors/type)**, **Components**, **Responsive notes**.

**Done when:** Another implementer could reproduce the chrome **without opening Unity**, or gaps are explicitly listed as TBD.

---

## Phase 3 — Questions for the developer (decision log)

**Goal:** Resolve product/tech choices **before** or **during** implementation so migration does not thrash.

**Rules:**

1. Ask **concrete** questions: binary or short enum, not “what do you prefer?” without options.
2. Map each question to **risk** (parity, performance, security, scope).
3. Record answers in a **Decision log** (table or bullets): ID, question, **answer**, **affected stories**, **default if no reply** (state it explicitly).
4. Typical topics: OS drop target (global vs assets panel only), file formats supported on web, undo model, server vs local save, a11y overrides, copy/paste parity (Sketcher stubs), i18n, theming.

**Done when:** All **blocking** questions for the current batch of stories have an answer or a documented default.

---

## Phase 4 — Migrate one user story at a time

**Goal:** Small, reviewable steps; each story maps to a PR or commit series.

**Rules:**

1. Pick **one** story (or a minimal dependency cluster) from Phase 1.
2. Implement **only** what that story requires in **`interactive-gltf-engine`** (frontend/backend/specs if needed).
3. If the change affects **portable format** (glTF JSON, script packaging, manifest), apply **`sync-interactive-gltf-format-from-engine`** from the **`interactive-gltf-specs`** repo in the same effort.
4. Link code to the **story ID** in PR description or commit message.
5. Do **not** expand scope to “while we’re here” refactors.

**Done when:** Story acceptance criteria are met in the target environment (e.g. dev server).

---

## Phase 5 — Verify functional parity (excluding developer decisions)

**Goal:** Confirm the web behavior **matches Sketcher** except where the Decision log says otherwise.

**Method:**

1. Build a **parity checklist** from the story’s acceptance criteria + Sketcher trace (shortcut, menu, edge case).
2. Manually or automatically test each row. Mark **PASS / FAIL / N/A**.
3. **N/A** only with a pointer to **Decision log** entry or **SKIP** story.
4. Note Unity-only **preconditions** (VR-only drop, factory mode) as **N/A (Sketcher only)**.
5. For FAIL, either fix or promote to a **new story** / decision.

**Done when:** All non-excluded rows pass or are explicitly deferred with tracking.

---

## Phase 6 — Coherence after all stories in the feature are implemented

**Goal:** The **whole feature** behaves consistently (UX, state, terminology, errors).

**Review checklist:**

1. **Cross-story:** Do shared shortcuts, focus rules, and selection models conflict?
2. **Data flow:** Save/load, undo, and API contracts consistent across panels touched by the feature?
3. **Errors:** User-visible messages and logging aligned with the rest of the editor?
4. **UI:** Spacing, tokens, and interaction patterns match Phase 2 or the approved design system deltas.
5. **Docs:** `migration.md` or feature doc updated with final behavior and known deltas.
6. **Spec/engine alignment:** If format changed, specs repo updated.

**Done when:** Reviewer (or self-review with user sign-off) confirms no contradictions and docs match reality.

---

## Quick reference: Sketcher paths (typical clone)

| Area | Typical path under Sketcher root |
|------|----------------------------------|
| Main layout | `Intraverse/Assets/Scripts/UI/UXML/UI_DTM.uxml`, `Main.uxml` |
| Styles | `…/UXML/Resources/Style/UI_DTM.uss`, component USS |
| Wiring | `…/Scripts/UI/UIManager.cs`, `InspectorPanel.cs`, `AssetsPanel.cs` |
| DnD / import | `…/DragAndDrop/`, `…/ImportAsset/ImportAssetPanel.cs`, `PlayAPI.cs` |
| Inventory | This repo: `igltf-editor-frontend/migration.md` |

---

## When not to use this skill

- Changes that **do not** reference Sketcher parity (greenfield UI with no migration intent).
- **SDK-only** work under `UMI3D-SDK-version-2.9` (read-only; not a migration target).
- **Normative format** work with no editor implementation — use **`edit-specification-interactive-gltf`** in **interactive-gltf-specs** instead.

---

*Skill version: initial. Maintainer: extend with project-specific paths or templates as the engine tree grows.*
