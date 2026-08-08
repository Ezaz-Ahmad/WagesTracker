import type { Client } from "@libsql/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/security/passwordHashing.js";
import { cleanupTestDb, createTestApp } from "./testApp.js";

// Covers PATCH /api/me/password end to end: current-password verification,
// new-password policy enforcement, password-reuse rejection, the atomic
// hash+token_version update, and — most importantly — that every JWT issued
// before the change stops working while a fresh replacement one keeps the
// current session alive (see the tokenVersion claim in backend/src/auth.ts).
describe("change password", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let userId: string;
  let originalToken: string;
  let otherUserToken: string;

  const email = "change-pw@example.com";
  const originalPassword = "original-secure-login-2026";

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Change PW User", email, password: originalPassword, rate: 20 });
    originalToken = signup.body.token;
    userId = signup.body.user.id;

    // A second, unrelated account — used to prove a password change never
    // has side effects on anyone else's session.
    const other = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Bystander User", email: "bystander@example.com", password: "bystander-account-secure-2026", rate: 15 });
    otherUserToken = other.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("requires authentication", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .send({ currentPassword: originalPassword, newPassword: "brand-new-secure-login-1" });
    expect(res.status).toBe(401);
  });

  it("rejects the wrong current password", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${originalToken}`)
      .send({ currentPassword: "totally-the-wrong-secret", newPassword: "brand-new-secure-login-1" });
    expect(res.status).toBe(401);
  });

  it("rejects a weak/blocklisted new password even with the correct current password", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${originalToken}`)
      .send({ currentPassword: originalPassword, newPassword: "iloveyouforever" });
    expect(res.status).toBe(400);
  });

  it("rejects reusing the current password as the new password", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${originalToken}`)
      .send({ currentPassword: originalPassword, newPassword: originalPassword });
    expect(res.status).toBe(400);
  });

  let replacementToken: string;
  const newPassword = "brand-new-secure-login-2026!";

  it("changes the password given the correct current password, returning 204 with a replacement token", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${originalToken}`)
      .send({ currentPassword: originalPassword, newPassword });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    replacementToken = res.headers["x-new-token"];
    expect(replacementToken).toBeTypeOf("string");
    expect(replacementToken).not.toBe(originalToken);
  });

  it("rejects the token that was issued before the password change", async () => {
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${originalToken}`);
    expect(res.status).toBe(401);
  });

  it("accepts the replacement token issued by the password change", async () => {
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${replacementToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it("can no longer log in with the old password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password: originalPassword });
    expect(res.status).toBe(401);
  });

  it("logs in successfully with the new password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password: newPassword });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
  });

  it("never returns the password or password hash anywhere in the change-password response", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${replacementToken}`)
      .send({ currentPassword: newPassword, newPassword: "yet-another-secure-login-3" });
    expect(res.status).toBe(204);
    const serialized = (JSON.stringify(res.body) + JSON.stringify(res.headers)).toLowerCase();
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain("yet-another-secure-login-3".toLowerCase());
  });

  it("stores the new password as an Argon2id hash that verifies against the new password", async () => {
    // Password changes always produce Argon2id — never bcrypt — regardless
    // of which format the account's previous hash was in.
    const result = await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [userId] });
    const hash = result.rows[0].password_hash as string;
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword("yet-another-secure-login-3", hash)).toBe(true);
    expect(await verifyPassword(newPassword, hash)).toBe(false);
  });

  it("leaves other users' sessions completely unaffected by this user's password change", async () => {
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${otherUserToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("bystander@example.com");
  });
});
