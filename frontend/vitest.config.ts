import { defineConfig } from "vitest/config";

export default defineConfig({
  // vite.config.ts injects these as build-time constants (the real version/
  // git commit/commit date — see its own comment) via `define`, but this is
  // a separate Vite config used only for tests, so anything that imports
  // lib/appVersion.ts (AppCredit, shown in SettingsScreen) would otherwise
  // crash with "__APP_VERSION__ is not defined" the moment a component test
  // renders it. The actual values don't matter here — no test asserts on
  // them — so these are fixed placeholders rather than duplicating
  // vite.config.ts's git-shelling logic.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
    __BUILD_HASH__: JSON.stringify("test"),
    __BUILD_DATE__: JSON.stringify("1970-01-01T00:00:00.000Z"),
    __NATIVE_CONSUMER_BUILD__: JSON.stringify(false),
  },
  test: {
    // Most tests here target pure calculation logic in src/lib (wage/
    // duration math, date handling, the session API client) — no DOM/React
    // rendering involved, so plain Node is the default and keeps that
    // majority fast. Component tests (src/**/*.test.tsx) need real rendering
    // instead — see src/screens/__tests__/SettingsScreen.test.tsx, which
    // opts into jsdom itself via a `// @vitest-environment jsdom` pragma
    // comment at the top of the file rather than switching this whole
    // project over to jsdom, so the pure-logic majority isn't slowed down
    // (or exposed to jsdom-only failure modes) just because a handful of
    // component tests need a DOM.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
