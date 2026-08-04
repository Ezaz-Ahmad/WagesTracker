import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/wage-tracker.sqlite";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    work_location_name TEXT NOT NULL DEFAULT '',
    work_address TEXT NOT NULL DEFAULT '',
    multiple_locations INTEGER NOT NULL DEFAULT 0,
    other_locations TEXT NOT NULL DEFAULT '',
    week_starts_on TEXT NOT NULL DEFAULT 'Monday',
    rate REAL NOT NULL DEFAULT 18.5,
    goal_hours REAL NOT NULL DEFAULT 35,
    goal_earnings REAL NOT NULL DEFAULT 647.5,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    sign_in TEXT,
    sign_out TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, date);
`);

export const RETENTION_YEARS = 3;

export function pruneExpiredShifts(): void {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  db.prepare("DELETE FROM shifts WHERE date < ?").run(cutoffKey);
}
