import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These tests target pure calculation logic in src/lib (wage/duration
    // math, date handling) — no DOM/React rendering involved, so plain Node
    // is enough and keeps the suite fast. If component tests are added
    // later, switch this to "jsdom" (and add @testing-library/react) rather
    // than assuming this config already covers that case.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
