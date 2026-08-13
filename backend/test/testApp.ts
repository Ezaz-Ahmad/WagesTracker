import type { Client } from "@libsql/client";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import express from "express";

/**
 * Spins up a fully isolated instance of the API for one test file: its own
 * temp SQLite file, its own Express app. Must be called from `beforeAll`
 * (never at module scope) — it sets the env vars `db.ts` reads at *import*
 * time, then dynamically imports `app.ts` only after those are set, so the
 * schema gets created fresh in this file's own database instead of
 * whatever a previously-run test file left behind in `process.env`.
 *
 * Explicitly clearing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN matters beyond
 * just test isolation: without it, a developer with those set in their real
 * shell/.env for local prod-like testing could accidentally point the test
 * suite at a real hosted database instead of a throwaway local file.
 *
 * Vitest gives each test *file* its own module registry by default, so
 * dynamically importing app.ts (and, transitively, db.ts) here happens
 * fresh per file — two test files calling this never share a database.
 */
export async function createTestApp(defaultShiftTimeZone = true): Promise<{ app: Express; db: Client; dbPath: string }> {
  const dbPath = path.join(os.tmpdir(), `wagetracker-test-${randomUUID()}.sqlite`);
  process.env.DB_PATH = dbPath;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.JWT_SECRET = "test-secret-do-not-use-in-production";
  process.env.NODE_ENV = "test";
  process.env.ADMIN_PASSWORD = "test-admin-password";
  process.env.ALLOWED_ORIGINS = "";

  const { createApp } = await import("../src/app.js");
  const { db } = await import("../src/db.js");
  const productionApp = createApp();
  if (!defaultShiftTimeZone) return { app: productionApp, db, dbPath };

  // Existing API tests model a browser making valid shift writes. Keep their
  // fixtures focused on the behaviour they were written to cover while the
  // dedicated clientTimeZone suite exercises missing/invalid headers against
  // the unwrapped production app.
  const app = express();
  app.use((req, _res, next) => {
    if (/^\/api\/shifts(?:\/|$)/.test(req.path) && (req.method === "POST" || req.method === "PATCH")) {
      req.headers["x-client-time-zone"] ??= "UTC";
    }
    next();
  });
  app.use(productionApp);
  return { app, db, dbPath };
}

/** Best-effort cleanup of a test file's temp SQLite file (plus its WAL/SHM
 * sidecar files) once its tests are done. Not load-bearing if it fails —
 * it's a temp-dir file the OS will clean up eventually either way. */
export function cleanupTestDb(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {
      // best-effort only
    }
  }
}
