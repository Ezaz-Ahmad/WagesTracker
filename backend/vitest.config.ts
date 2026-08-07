import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Plain Node — this is an API, no DOM involved. Each test *file* still
    // gets its own fresh module registry (Vitest's default), which is what
    // lets test/testApp.ts hand every file its own isolated temp SQLite
    // database (see the comment there) without files stepping on each
    // other's data.
    environment: "node",
    include: ["test/**/*.test.ts"],
    // bcryptjs hashing + several sequential HTTP round-trips per test file
    // comfortably clears Vitest's 5s default, but gives a little more
    // headroom on a slower CI runner rather than risking a flaky timeout.
    testTimeout: 15_000,
    // `beforeAll` in every file dynamically imports app.ts (and,
    // transitively, db.ts), which creates a fresh SQLite file and runs the
    // full schema migration — slower than a normal test on a loaded CI
    // runner, and past Vitest's 10s default hook timeout often enough to be
    // worth raising explicitly rather than risking a flaky failure.
    hookTimeout: 30_000,
  },
});
