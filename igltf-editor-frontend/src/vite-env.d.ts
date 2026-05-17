/// <reference types="vite/client" />

declare module '*?raw' {
  const src: string
  export default src
}

declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}

interface ImportMetaEnv {
  readonly VITE_BASE?: string
  readonly VITE_API_BASE_URL?: string
  /** App semver (aligned with Cargo / tauri.conf; injected in vite.config). */
  readonly VITE_APP_VERSION: string
  /** Parent of per-project dirs on disk (same as backend STORAGE_ROOT). Enables Open in IDE without saving prefs. */
  readonly VITE_DEV_STORAGE_ROOT?: string
  /** `1`/`true`: show Open in IDE even when API host is not loopback; `0`/`false`: hide it. */
  readonly VITE_OPEN_IN_IDE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
