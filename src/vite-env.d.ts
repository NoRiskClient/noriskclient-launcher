/// <reference types="vite/client" />

declare const __SKIN_RENDERER_VERSION__: string;

// Tauri environment detection for debug mode
declare global {
  interface Window {
    __TAURI__?: any;
    __TAURI_INTERNALS__?: any;
    __TAURI_METADATA__?: any;
  }
}

// Vite environment variables (already defined by Vite, but explicit for clarity)
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
