import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("legacy weekly-extra attribution migration", () => {
  const dbPath = path.join(os.tmpdir(), `wagetracker-week-extra-migration-${randomUUID()}.sqlite`);

  beforeAll(async () => {
    const legacy = createClient({ url: `file:${dbPath}` });
    await legacy.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        work_location_name TEXT NOT NULL DEFAULT '',
        work_address TEXT NOT NULL DEFAULT '',
        multiple_locations INTEGER NOT NULL DEFAULT 0,
        other_locations TEXT NOT NULL DEFAULT '',
        week_starts_on TEXT NOT NULL DEFAULT 'Monday',
        rate REAL NOT NULL DEFAULT 18.5,
        goal_hours REAL NOT NULL DEFAULT 35,
        goal_earnings REAL NOT NULL DEFAULT 647.5,
        token_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE week_extras (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_start TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, week_start)
      );
      INSERT INTO users
        (id, name, email, password_hash, week_starts_on, created_at)
        VALUES ('legacy-user', 'Legacy User', 'legacy@example.com', 'unused', 'Monday', '2025-01-01T00:00:00.000Z');
      INSERT INTO week_extras
        (id, user_id, week_start, amount, reason, created_at, updated_at)
        VALUES ('legacy-extra', 'legacy-user', '2026-01-05', 42.5, 'Original bonus',
                '2026-01-11T00:00:00.000Z', '2026-01-11T00:00:00.000Z');
    `);
    legacy.close();

    process.env.DB_PATH = dbPath;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* best effort */ }
    }
  });

  it("adds the stable closing date without changing the existing row", async () => {
    const { db } = await import("../src/db.js");
    const result = await db.execute({
      sql: "SELECT id, user_id, week_start, effective_date, amount, reason, created_at, updated_at FROM week_extras",
      args: [],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: "legacy-extra",
      user_id: "legacy-user",
      week_start: "2026-01-05",
      effective_date: "2026-01-11",
      amount: 42.5,
      reason: "Original bonus",
      created_at: "2026-01-11T00:00:00.000Z",
      updated_at: "2026-01-11T00:00:00.000Z",
    });
    db.close();
  });
});
