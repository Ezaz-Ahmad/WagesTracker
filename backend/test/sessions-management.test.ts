import type { Client } from "@libsql/client";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

// Covers the /api/me/sessions management endpoints (list, revoke one, revoke
// others) and POST /api/auth/logout — split into its own file/app instance
// from sessions.test.ts purely so the two files' combined signup/login calls
// don't trip the auth-route rate limiter (20 req/15min).
describe("session management", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  async function signupUser(email: string, password: string, name = "Session Mgmt User") {
    const res = await request(app).post("/api/auth/signup").send({ name, email, password, rate: 20 });
    return { token: res.body.token as string, userId: res.body.user.id as string };
  }

  function decodeToken(token: string): { sub: string; tokenVersion: number; sid: string } {
    return jwt.decode(token) as { sub: string; tokenVersion: number; sid: string };
  }

  it("lists only the authenticated user's own sessions", async () => {
    const a = await signupUser("list-user-a@example.com", "list-user-a-password-2026");
    const b = await signupUser("list-user-b@example.com", "list-user-b-password-2026");

    const listA = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${a.token}`);
    expect(listA.status).toBe(200);
    expect(listA.body.sessions).toHaveLength(1);
    expect(listA.body.sessions[0].isCurrent).toBe(true);

    const listB = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${b.token}`);
    expect(listB.body.sessions).toHaveLength(1);
    expect(listB.body.sessions[0].id).not.toBe(listA.body.sessions[0].id);
  });

  it("never exposes a token, password, or password hash in the sessions list response", async () => {
    const { token } = await signupUser("no-leak-session@example.com", "no-leak-session-password-2026");
    const res = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${token}`);
    const serialized = JSON.stringify(res.body).toLowerCase();
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("tokenversion");
    expect(serialized).not.toContain(token.toLowerCase());
  });

  it("returns 404 when trying to revoke a session id that was never issued", async () => {
    const { token } = await signupUser("revoke-404@example.com", "revoke-404-password-2026");
    const res = await request(app)
      .delete("/api/me/sessions/not-a-real-session-id")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 (not the target's data) when trying to revoke another user's session, which has zero effect on it", async () => {
    const a = await signupUser("cross-revoke-a@example.com", "cross-revoke-a-password-2026");
    const b = await signupUser("cross-revoke-b@example.com", "cross-revoke-b-password-2026");
    const bSid = decodeToken(b.token).sid;

    const res = await request(app).delete(`/api/me/sessions/${bSid}`).set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(404);

    const stillWorks = await request(app).get("/api/me").set("Authorization", `Bearer ${b.token}`);
    expect(stillWorks.status).toBe(200);
  });

  it("revoking one session leaves the user's other sessions untouched", async () => {
    const email = "isolated-revoke@example.com";
    const password = "isolated-revoke-password-2026";
    const first = await signupUser(email, password);
    const second = await request(app).post("/api/auth/login").send({ email, password });
    const secondToken = second.body.token as string;
    const firstSid = decodeToken(first.token).sid;

    const revoke = await request(app)
      .delete(`/api/me/sessions/${firstSid}`)
      .set("Authorization", `Bearer ${secondToken}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedCurrent).toBe(false);

    const firstNowRejected = await request(app).get("/api/me").set("Authorization", `Bearer ${first.token}`);
    expect(firstNowRejected.status).toBe(401);

    const secondStillWorks = await request(app).get("/api/me").set("Authorization", `Bearer ${secondToken}`);
    expect(secondStillWorks.status).toBe(200);
  });

  it("reports revokedCurrent and logs the caller out when they revoke their own session", async () => {
    const { token } = await signupUser("revoke-self@example.com", "revoke-self-password-2026");
    const sid = decodeToken(token).sid;
    const res = await request(app).delete(`/api/me/sessions/${sid}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.revokedCurrent).toBe(true);

    const after = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it("revoking all other sessions preserves the current one", async () => {
    const email = "revoke-others@example.com";
    const password = "revoke-others-password-2026";
    const first = await signupUser(email, password);
    const second = await request(app).post("/api/auth/login").send({ email, password });
    const third = await request(app).post("/api/auth/login").send({ email, password });
    const secondToken = second.body.token as string;
    const thirdToken = third.body.token as string;

    const res = await request(app).delete("/api/me/sessions/others").set("Authorization", `Bearer ${thirdToken}`);
    expect(res.status).toBe(204);

    const thirdStillWorks = await request(app).get("/api/me").set("Authorization", `Bearer ${thirdToken}`);
    expect(thirdStillWorks.status).toBe(200);

    const firstNowRejected = await request(app).get("/api/me").set("Authorization", `Bearer ${first.token}`);
    expect(firstNowRejected.status).toBe(401);
    const secondNowRejected = await request(app).get("/api/me").set("Authorization", `Bearer ${secondToken}`);
    expect(secondNowRejected.status).toBe(401);
  });

  it("server-side logout invalidates the current JWT immediately", async () => {
    const { token } = await signupUser("logout-invalidate@example.com", "logout-invalidate-password-2026");
    const before = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const after = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it("throttles last_seen_at updates — rapid requests don't rewrite it, but a stale value gets refreshed", async () => {
    const { token } = await signupUser("throttle-last-seen@example.com", "throttle-last-seen-password-2026");
    const sid = decodeToken(token).sid;

    const first = await db.execute({ sql: "SELECT last_seen_at FROM user_sessions WHERE id = ?", args: [sid] });
    const firstSeen = first.rows[0].last_seen_at as string;

    // A second request moments later must NOT move last_seen_at forward —
    // otherwise every single authenticated request would be a write.
    await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    const stillSame = await db.execute({ sql: "SELECT last_seen_at FROM user_sessions WHERE id = ?", args: [sid] });
    expect(stillSame.rows[0].last_seen_at).toBe(firstSeen);

    // Force the stored value to look 6 minutes old (past the 5-minute
    // throttle window) — the next request must refresh it.
    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await db.execute({ sql: "UPDATE user_sessions SET last_seen_at = ? WHERE id = ?", args: [staleTime, sid] });
    await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    const refreshed = await db.execute({ sql: "SELECT last_seen_at FROM user_sessions WHERE id = ?", args: [sid] });
    expect(refreshed.rows[0].last_seen_at).not.toBe(staleTime);
    expect(new Date(refreshed.rows[0].last_seen_at as string).getTime()).toBeGreaterThan(new Date(staleTime).getTime());
  });
});
