/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SHA-256 hex of the page access password (see src/gate.ts). Optional —
   *  falls back to the default hash baked into gate.ts when unset. */
  readonly VITE_GATE_HASH?: string;
  /** Intake form URL (or mailto:) behind "Request an accessibility test".
   *  Optional — see src/config.ts for the fallback. */
  readonly VITE_REQUEST_TEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
