/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  /** Public board polling interval (ms). */
  readonly VITE_PUBLIC_STATE_POLL_MS?: string;
}
