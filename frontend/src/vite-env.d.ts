/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** "true" builds the temporary on-device viewport diagnostics overlay into
   * the bundle (see components/ViewportDebugOverlay.tsx). Unset in every
   * normal build, which folds the flag to false and tree-shakes the overlay
   * away entirely. */
  readonly VITE_VIEWPORT_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by vite.config.ts's `define` block at build time — see there for
// how these are computed (package.json version + git commit info).
declare const __APP_VERSION__: string;
declare const __BUILD_HASH__: string;
declare const __BUILD_DATE__: string;
