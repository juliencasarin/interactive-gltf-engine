import * as monaco from 'monaco-editor'
import { GLTF_SCRIPT_IMPORT_PATH, INTERACTION_BASES_IMPORT_PATH } from './interactionBasesUrl'

// Vite worker modules for Monaco
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

let monacoWorkersConfigured = false

export function configureMonacoEnvironment(): void {
  if (monacoWorkersConfigured) return
  monacoWorkersConfigured = true
  ;(self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }
}

/**
 * Classic JavaScript authoring only — no TypeScript .d.ts extra libs or checkJs.
 * Syntax highlighting uses the JS grammar; diagnostics stay lightweight (no semantic TS checks).
 */
export function registerIgltfHostExtraLibs(): void {
  configureMonacoEnvironment()
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    strict: false,
    checkJs: false,
    allowJs: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
  })
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true,
  })
}

/** Default interaction script: kind base → Interaction → GlTFScript. */
export const DEFAULT_SCRIPT_TEMPLATE = `import { EventInteraction } from '${INTERACTION_BASES_IMPORT_PATH}'

export class ExampleInteraction extends EventInteraction {
  constructor() {
    super()
  }

  onLoaded() {
    // TODO: runs once when the script instance is attached in Play.
  }

  onUpdate(delta) {
    // TODO: optional per-frame hook (delta in seconds).
  }

  onDelete() {
    // TODO: optional teardown when the scene unmounts.
  }

  onEvent(payload) {
    if (typeof GLTF !== "undefined" && GLTF.getObjectByUmi3dId) {
      void GLTF.apiVersion
    }
    void payload
    return undefined
  }
}
`

/** Behaviour script (scriptRole: behaviour) — extends GlTFScript directly. */
export const DEFAULT_BEHAVIOUR_SCRIPT_TEMPLATE = `import { GlTFScript } from '${GLTF_SCRIPT_IMPORT_PATH}'

export class ExampleBehaviour extends GlTFScript {
  constructor() {
    super()
  }

  onLoaded() {
    // TODO: runs once when attached to a scene node in Play.
  }

  onUpdate(delta) {
    // TODO: optional per-frame hook (delta in seconds).
  }

  onDelete() {
    // TODO: optional teardown when the scene unmounts.
  }
}
`
