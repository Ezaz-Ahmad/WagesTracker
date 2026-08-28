import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("legacy work-location migration", () => {
  const dbPath = path.join(os.tmpdir(), `wagetracker-work-location-migration-${randomUUID()}.sqlite`);

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
      CREATE TABLE shifts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        sign_in TEXT,
        sign_out TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE day_expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        fuel_cost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, date)
      );
      INSERT INTO users (id, name, email, password_hash, work_location_name, work_address, other_locations, created_at)
        VALUES ('legacy-user', 'Legacy User', 'legacy@example.com', 'unused', ' Main   Office ', '1 Main St', 'Configured Site', '2025-01-01T00:00:00.000Z');
      INSERT INTO shifts (id, user_id, date, location, sign_in, sign_out, created_at, updated_at)
        VALUES ('shift-main', 'legacy-user', '2026-08-10', 'MAIN OFFICE', '09:00', '10:00', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z');
      INSERT INTO shifts (id, user_id, date, location, sign_in, sign_out, created_at, updated_at)
        VALUES ('shift-legacy', 'legacy-user', '2026-08-11', 'Legacy   Site', '09:00', '10:00', '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z');
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

  it("creates stable rows, archives historical-only names, and links every old shift", async () => {
    const { db } = await import("../src/db.js");
    const locations = await db.execute({
      sql: "SELECT name, normalized_name, archived_at FROM work_locations WHERE user_id = ? ORDER BY normalized_name",
      args: ["legacy-user"],
    });
    expect(locations.rows).toHaveLength(3);
    expect(locations.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Main Office", normalized_name: "main office", archived_at: null }),
      expect.objectContaining({ name: "Configured Site", normalized_name: "configured site", archived_at: null }),
      expect.objectContaining({ name: "Legacy Site", normalized_name: "legacy site" }),
    ]));
    const legacyOnly = locations.rows.find((row) => row.normalized_name === "legacy site");
    expect(legacyOnly?.archived_at).toEqual(expect.any(String));

    const shifts = await db.execute({
      sql: "SELECT id, location, location_snapshot, work_location_id FROM shifts ORDER BY id",
      args: [],
    });
    expect(shifts.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "shift-main", location: "MAIN OFFICE", location_snapshot: "MAIN OFFICE" }),
      expect.objectContaining({ id: "shift-legacy", location: "Legacy   Site", location_snapshot: "Legacy   Site" }),
    ]));
    expect(shifts.rows.every((row) => typeof row.work_location_id === "string")).toBe(true);
    db.close();
  });
});
