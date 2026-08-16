import type { Client } from "@libsql/client";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";
import { SESSION_IDLE_TIMEOUT_MS } from "../src/security/sessionPolicy.js";

// Covers PATCH /api/me/sessions/current, the endpoint the frontend calls when
// biometric login is turned on/off (see AppContext.tsx's
// enableBiometricLoginAction/disableBiometricLogin) to mark/unmark the
// current session as exempt from the idle timeout — see session-idle.test.ts
// for the validateSession-level exemption this endpoint's flag drives.
describe("PATCH /api/me/sessions/current (biometric protection)", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  async function signup(email: string) {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Biometric Session User", email, password: "biometric-protection-password-2026", rate: 20 });
    return { token: res.body.token as string, userId: res.body.user.id as string };
  }

  const sidOf = (token: string) => (jwt.decode(token) as { sid: string }).sid;

  async function ageSession(sessionId: string, ms: number) {
    await db.execute({
      sql: "UPDATE user_sessions SET last_seen_at = ? WHERE id = ?",
      args: [new Date(Date.now() - ms).toISOString(), sessionId],
    });
  }

  it("marking the current session protected exempts it from the idle timeout", async () => {
    const { token } = await signup("mark-protected@example.com");
    const sid = sidOf(token);

    const patch = await request(app)
      .patch("/api/me/sessions/current")
      .set("Authorization", `Bearer ${token}`)
      .send({ biometricProtected: true });
    expect(patch.status).toBe(204);

    await ageSession(sid, SESSION_IDLE_TIMEOUT_MS + 60_000);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("unmarking it restores the ordinary idle timeout", async () => {
    const { token } = await signup("unmark-protected@example.com");
    const sid = sidOf(token);

    await request(app).patch("/api/me/sessions/current").set("Authorization", `Bearer ${token}`).send({ biometricProtected: true });
    await request(app).patch("/api/me/sessions/current").set("Authorization", `Bearer ${token}`).send({ biometricProtected: false });

    await ageSession(sid, SESSION_IDLE_TIMEOUT_MS + 60_000);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
  });

  it("only ever affects the caller's own current session, never another one by id or another user's", async () => {
    const a = await signup("scope-a@example.com");
    const b = await signup("scope-b@example.com");

    await request(app).patch("/api/me/sessions/current").set("Authorization", `Bearer ${a.token}`).send({ biometricProtected: true });

    await ageSession(sidOf(b.token), SESSION_IDLE_TIMEOUT_MS + 60_000);
    // B's session was never touched by A's request — still ordinary idle rules.
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${b.token}`)).status).toBe(401);
  });

  it("rejects a non-boolean body instead of silently coercing it", async () => {
    const { token } = await signup("bad-body@example.com");
    const res = await request(app)
      .patch("/api/me/sessions/current")
      .set("Authorization", `Bearer ${token}`)
      .send({ biometricProtected: "yes" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).patch("/api/me/sessions/current").send({ biometricProtected: true });
    expect(res.status).toBe(401);
  });

  it("does not extend or otherwise touch the session's own last_seen_at/expires_at", async () => {
    const { token } = await signup("no-side-effects@example.com");
    const sid = sidOf(token);
    const before = await db.execute({
      sql: "SELECT last_seen_at, expires_at FROM user_sessions WHERE id = ?",
      args: [sid],
    });

    await request(app).patch("/api/me/sessions/current").set("Authorization", `Bearer ${token}`).send({ biometricProtected: true });

    const after = await db.execute({
      sql: "SELECT last_seen_at, expires_at FROM user_sessions WHERE id = ?",
      args: [sid],
    });
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("is reflected in the sessions list as biometricProtected", async () => {
    const { token } = await signup("listed-flag@example.com");

    await request(app).patch("/api/me/sessions/current").set("Authorization", `Bearer ${token}`).send({ biometricProtected: true });

    const list = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${token}`);
    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.sessions[0].biometricProtected).toBe(true);
  });
});
