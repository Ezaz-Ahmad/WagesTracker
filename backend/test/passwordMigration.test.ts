import type { Client } from "@libsql/client";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

// Covers backward compatibility with password hashes created before the
// Argon2id migration. Existing bcrypt hashes must keep working indefinitely
// (never a forced reset), and every password-checking code path — login and
// account deletion — has to handle both formats via the same shared
// verifyPassword helper (backend/src/security/passwordHashing.ts).
describe("legacy bcrypt password migration", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  /** Inserts a user row with an old-style bcrypt hash directly, the same
   * way a genuinely pre-migration production row would already look —
   * signup itself can no longer produce a bcrypt hash. */
  async function insertLegacyBcryptUser(email: string, password: string) {
    const id = randomUUID();
    const hash = await bcrypt.hash(password, 10);
    await db.execute({
      sql: "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, "Legacy Bcrypt User", email, hash, new Date().toISOString()],
    });
    return { id, hash };
  }

  it("logs in successfully with an existing bcrypt-hashed password", async () => {
    const email = "legacy-bcrypt-login@example.com";
    const password = "legacy-bcrypt-account-password-2026";
    await insertLegacyBcryptUser(email, password);

    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
  });

  it("transparently upgrades a bcrypt hash to Argon2id after a successful login", async () => {
    const email = "legacy-bcrypt-upgrade@example.com";
    const password = "upgrade-me-on-next-login-2026";
    const { id, hash: originalHash } = await insertLegacyBcryptUser(email, password);

    const before = await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [id] });
    expect(before.rows[0].password_hash as string).toBe(originalHash);
    expect(before.rows[0].password_hash as string).toMatch(/^\$2[aby]\$/);

    const login = await request(app).post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);

    const after = await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [id] });
    const upgraded = after.rows[0].password_hash as string;
    expect(upgraded).toMatch(/^\$argon2id\$/);
    expect(upgraded).not.toBe(originalHash);

    // And the same password keeps working, now against the upgraded hash.
    const secondLogin = await request(app).post("/api/auth/login").send({ email, password });
    expect(secondLogin.status).toBe(200);
  });

  it("deletes an account whose password is still checked against a legacy bcrypt hash", async () => {
    // Mints a JWT directly (rather than via /api/auth/login) so this
    // exercises DELETE /api/me's own bcrypt-verification path specifically —
    // logging in first would already upgrade the hash to Argon2id (proven
    // above) before deletion ever ran, which wouldn't prove this endpoint
    // itself supports the legacy format.
    const email = "legacy-bcrypt-delete@example.com";
    const password = "delete-this-legacy-bcrypt-account-2026";
    const { id } = await insertLegacyBcryptUser(email, password);
    const token = jwt.sign({ sub: id, tokenVersion: 0 }, process.env.JWT_SECRET!, { expiresIn: "30d" });

    const del = await request(app).delete("/api/me").set("Authorization", `Bearer ${token}`).send({ password });
    expect(del.status).toBe(204);

    const remaining = await db.execute({ sql: "SELECT COUNT(*) as c FROM users WHERE id = ?", args: [id] });
    expect(Number(remaining.rows[0].c)).toBe(0);
  });

  it("also deletes an account whose password is an Argon2id hash (the normal, non-legacy case)", async () => {
    const email = "argon2-delete@example.com";
    const password = "argon2-account-delete-password-2026";
    const signup = await request(app).post("/api/auth/signup").send({ name: "Argon2 User", email, password, rate: 20 });
    expect(signup.status).toBe(201);
    const token = signup.body.token;

    const del = await request(app).delete("/api/me").set("Authorization", `Bearer ${token}`).send({ password });
    expect(del.status).toBe(204);
  });
});
