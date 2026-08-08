import type { Client } from "@libsql/client";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/security/passwordHashing.js";
import { cleanupTestDb, createTestApp } from "./testApp.js";

// Covers the signup-time password policy (backend/src/security/passwordPolicy.ts):
// 15-128 chars, no composition rules, a common/app-specific-password blocklist,
// and — critically — that the policy applies only going forward, never locking
// existing accounts out of a password they set before this policy existed.
describe("password policy (signup)", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("rejects a password shorter than 15 characters (14 exactly)", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Too Short", email: "too-short@example.com", password: "a".repeat(14), rate: 20 });
    expect(res.status).toBe(400);
  });

  it("accepts a valid 15+ character passphrase", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Valid Passphrase", email: "valid-passphrase@example.com", password: "quiet-mountain-river-2026", rate: 20 });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
  });

  it("accepts spaces and symbols in a password, without requiring them", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({
        name: "Spaces And Symbols",
        email: "spaces-symbols@example.com",
        password: "lighthouse harbor #77 sails free!",
        rate: 20,
      });
    expect(res.status).toBe(201);
  });

  it("rejects a common/blocklisted password even when it's 15+ characters", async () => {
    // "iloveyouforever" is exactly 15 characters — long enough to pass the
    // length check alone, so this specifically exercises the blocklist.
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Common Password", email: "common-password@example.com", password: "iloveyouforever", rate: 20 });
    expect(res.status).toBe(400);
  });

  it("rejects a password containing an obvious WagesTracker-specific value", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "App Named", email: "app-named@example.com", password: "MyWageTracker2026Secure", rate: 20 });
    expect(res.status).toBe(400);
  });

  it("rejects a password longer than 128 characters", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Too Long", email: "too-long@example.com", password: "x".repeat(129), rate: 20 });
    expect(res.status).toBe(400);
  });

  it("lets an existing account with an older, shorter password still log in", async () => {
    // Simulates an account created before the 15-character minimum existed —
    // signup itself can no longer produce one, so this inserts directly,
    // the same way a genuinely pre-existing row would already be sitting in
    // production. Login must not retroactively enforce the new policy.
    const email = "legacy-short-password@example.com";
    const shortPassword = "old6char"; // 8 characters — would fail signup today
    const passwordHash = await hashPassword(shortPassword);
    await db.execute({
      sql: "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [randomUUID(), "Legacy User", email, passwordHash, new Date().toISOString()],
    });

    const res = await request(app).post("/api/auth/login").send({ email, password: shortPassword });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
  });
});
