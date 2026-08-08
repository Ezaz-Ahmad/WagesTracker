import type { Client } from "@libsql/client";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

// Covers session creation and requireAuth's session-validity checks: session
// creation on signup/login, and the `sid` JWT claim requireAuth checks
// against `user_sessions` on every request. This sits on top of — not
// instead of — the existing JWT signature/expiry and `token_version` checks
// covered elsewhere. Session *management* (listing, revoking, logout,
// last_seen_at throttling) is covered separately in
// sessions-management.test.ts — split into its own file/app instance purely
// so the two files' combined signup/login calls don't trip the auth-route
// rate limiter (20 req/15min, the same one real users are protected by).
describe("sessions", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  async function signupUser(email: string, password: string, name = "Session Test User") {
    const res = await request(app).post("/api/auth/signup").send({ name, email, password, rate: 20 });
    return { token: res.body.token as string, userId: res.body.user.id as string };
  }

  function decodeToken(token: string): { sub: string; tokenVersion: number; sid: string } {
    return jwt.decode(token) as { sub: string; tokenVersion: number; sid: string };
  }

  it("creates a session row on signup", async () => {
    const { token, userId } = await signupUser("signup-session@example.com", "signup-session-password-2026");
    const { sid } = decodeToken(token);
    expect(sid).toBeTypeOf("string");
    const row = await db.execute({ sql: "SELECT * FROM user_sessions WHERE id = ?", args: [sid] });
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].user_id).toBe(userId);
  });

  it("creates a separate session on each login, distinct from the signup session", async () => {
    const email = "login-session@example.com";
    const password = "login-session-password-2026";
    const signup = await signupUser(email, password);
    const signupSid = decodeToken(signup.token).sid;

    const login = await request(app).post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    const loginSid = decodeToken(login.body.token).sid;

    expect(loginSid).not.toBe(signupSid);
    const rows = await db.execute({
      sql: "SELECT COUNT(*) as c FROM user_sessions WHERE user_id = ?",
      args: [decodeToken(signup.token).sub],
    });
    expect(Number(rows.rows[0].c)).toBeGreaterThanOrEqual(2);
  });

  it("issues a JWT whose sid claim points at a real session row belonging to the same user", async () => {
    const { token, userId } = await signupUser("valid-sid@example.com", "valid-sid-password-2026");
    const { sub, sid } = decodeToken(token);
    expect(sub).toBe(userId);
    const row = await db.execute({ sql: "SELECT user_id FROM user_sessions WHERE id = ?", args: [sid] });
    expect(row.rows[0]?.user_id).toBe(userId);
  });

  it("allows an active session to access a protected endpoint", async () => {
    const { token } = await signupUser("active-session@example.com", "active-session-password-2026");
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("rejects a token whose session has been revoked", async () => {
    const { token } = await signupUser("revoked-session@example.com", "revoked-session-password-2026");
    const { sid } = decodeToken(token);
    await db.execute({ sql: "UPDATE user_sessions SET revoked_at = ? WHERE id = ?", args: [new Date().toISOString(), sid] });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired token");
  });

  it("rejects a token whose session has expired", async () => {
    const { token } = await signupUser("expired-session@example.com", "expired-session-password-2026");
    const { sid } = decodeToken(token);
    const past = new Date(Date.now() - 1000).toISOString();
    await db.execute({ sql: "UPDATE user_sessions SET expires_at = ? WHERE id = ?", args: [past, sid] });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects a token whose session no longer exists", async () => {
    const { token, userId } = await signupUser("nonexistent-session@example.com", "nonexistent-session-password-2026");
    const { sid } = decodeToken(token);
    await db.execute({ sql: "DELETE FROM user_sessions WHERE id = ?", args: [sid] });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    // Sanity check: only the session vanished, not the user row itself.
    const user = await db.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [userId] });
    expect(user.rows).toHaveLength(1);
  });

  it("rejects a JWT with no sid claim at all (the pre-migration token shape)", async () => {
    const { userId } = await signupUser("no-sid@example.com", "no-sid-session-password-2026");
    const legacyShapedToken = jwt.sign({ sub: userId, tokenVersion: 0 }, process.env.JWT_SECRET!, { expiresIn: "30d" });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${legacyShapedToken}`);
    expect(res.status).toBe(401);
  });

  it("rejects a forged token combining one user's id with another user's session id", async () => {
    const a = await signupUser("forge-user-a@example.com", "forge-user-a-password-2026");
    const b = await signupUser("forge-user-b@example.com", "forge-user-b-password-2026");
    const forgedToken = jwt.sign(
      { sub: a.userId, tokenVersion: 0, sid: decodeToken(b.token).sid },
      process.env.JWT_SECRET!,
      { expiresIn: "30d" }
    );
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${forgedToken}`);
    expect(res.status).toBe(401);
  });
});
