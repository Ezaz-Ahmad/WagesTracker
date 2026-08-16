import type { Client } from "@libsql/client";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";
import { SESSION_IDLE_TIMEOUT_MS, LAST_SEEN_THROTTLE_MS } from "../src/security/sessionPolicy.js";

/**
 * The server-enforced idle timeout. Previously the only idle logout lived in
 * the frontend, measured against a localStorage timestamp — which is to say
 * it protected a cooperative browser and nothing else. A stolen token used
 * from anywhere but that browser was unaffected by it. This enforces the
 * same rule where it can't be skipped.
 *
 * Idle expiry is applied at validation time rather than by a sweep job, so
 * these tests age a session by writing `last_seen_at` directly: that is
 * exactly the state the server would be in after the user walked away, with
 * no waiting and no dependence on a background task having run.
 */
describe("server-enforced session idle timeout", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  const PASSWORD = "idle-timeout-password-2026";
  let ipCounter = 0;
  const uniqueIp = () => `10.20.${Math.floor((ipCounter += 1) / 256) % 256}.${ipCounter % 256}`;

  async function signup(email: string) {
    const res = await request(app)
      .post("/api/auth/signup")
      .set("X-Forwarded-For", uniqueIp())
      .send({ name: "Idle Test", email, password: PASSWORD, rate: 20, deviceInstallationId: randomUUID() });
    return { token: res.body.token as string, userId: res.body.user.id as string };
  }

  const sidOf = (token: string) => (jwt.decode(token) as { sid: string }).sid;

  /** Rewinds a session's last activity by the given number of milliseconds. */
  async function ageSession(sessionId: string, ms: number) {
    await db.execute({
      sql: "UPDATE user_sessions SET last_seen_at = ? WHERE id = ?",
      args: [new Date(Date.now() - ms).toISOString(), sessionId],
    });
  }

  it("rejects a token whose session has been idle past the timeout", async () => {
    const { token } = await signup("idle-reject@example.com");
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);

    await ageSession(sidOf(token), SESSION_IDLE_TIMEOUT_MS + 60_000);

    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired token");
  });

  it("still accepts a session that is idle but within the timeout", async () => {
    const { token } = await signup("idle-within@example.com");
    await ageSession(sidOf(token), SESSION_IDLE_TIMEOUT_MS - 60_000);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("keeps a session alive indefinitely while it is being used", async () => {
    const { token } = await signup("kept-alive@example.com");
    const sid = sidOf(token);

    // Four rounds of "sat almost long enough to expire, then used again".
    // The throttle is shorter than the timeout, so each request refreshes
    // last_seen_at and the session never drifts into looking idle.
    for (let i = 0; i < 4; i += 1) {
      await ageSession(sid, LAST_SEEN_THROTTLE_MS + 30_000);
      const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    }

    const row = await db.execute({ sql: "SELECT last_seen_at FROM user_sessions WHERE id = ?", args: [sid] });
    const lastSeen = new Date(String((row.rows[0] as unknown as { last_seen_at: string }).last_seen_at)).getTime();
    expect(Date.now() - lastSeen).toBeLessThan(SESSION_IDLE_TIMEOUT_MS);
  });

  it("omits idle-expired sessions from the sessions list", async () => {
    const { token, userId } = await signup("idle-list@example.com");

    // A second session for the same account that has since gone quiet.
    const staleId = randomUUID();
    await db.execute({
      sql: `INSERT INTO user_sessions (id, user_id, user_agent, ip_address, created_at, last_seen_at, expires_at, device_installation_id, device_name)
            VALUES (?, ?, 'Old Device', '203.0.113.1', ?, ?, ?, ?, '')`,
      args: [
        staleId,
        userId,
        new Date(Date.now() - 86_400_000).toISOString(),
        new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS - 60_000).toISOString(),
        new Date(Date.now() + 86_400_000).toISOString(),
        randomUUID(),
      ],
    });

    const res = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = (res.body.sessions as { id: string }[]).map((s) => s.id);
    // Listing something the server would reject on its next request would
    // make the screen actively misleading.
    expect(ids).not.toContain(staleId);
    expect(ids).toContain(sidOf(token));
  });

  it("omits absolutely-expired and revoked sessions from the list", async () => {
    const { token, userId } = await signup("expired-list@example.com");
    const nowIso = new Date().toISOString();

    const expiredId = randomUUID();
    const revokedId = randomUUID();
    await db.batch(
      [
        {
          sql: `INSERT INTO user_sessions (id, user_id, user_agent, ip_address, created_at, last_seen_at, expires_at, device_installation_id, device_name)
                VALUES (?, ?, 'Expired', '', ?, ?, ?, ?, '')`,
          args: [expiredId, userId, nowIso, nowIso, new Date(Date.now() - 1000).toISOString(), randomUUID()],
        },
        {
          sql: `INSERT INTO user_sessions (id, user_id, user_agent, ip_address, created_at, last_seen_at, expires_at, revoked_at, device_installation_id, device_name)
                VALUES (?, ?, 'Revoked', '', ?, ?, ?, ?, ?, '')`,
          args: [
            revokedId,
            userId,
            nowIso,
            nowIso,
            new Date(Date.now() + 86_400_000).toISOString(),
            nowIso,
            randomUUID(),
          ],
        },
      ],
      "write"
    );

    const res = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${token}`);
    const ids = (res.body.sessions as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(expiredId);
    expect(ids).not.toContain(revokedId);
  });

  it("does not resurrect an idle session just because another device is active", async () => {
    const { token, userId } = await signup("idle-isolated@example.com");
    const otherToken = (
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", uniqueIp())
        .send({ email: "idle-isolated@example.com", password: PASSWORD, deviceInstallationId: randomUUID() })
    ).body.token as string;

    await ageSession(sidOf(token), SESSION_IDLE_TIMEOUT_MS + 60_000);

    // The active device keeps working; the idle one does not come back with it.
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${otherToken}`)).status).toBe(200);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);

    const list = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${otherToken}`);
    const ids = (list.body.sessions as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual([sidOf(otherToken)]);
    expect(userId).toBeTruthy();
  });

  // A session marked biometric_protected (see PATCH /api/me/sessions/current
  // and validateSession's exemption in security/sessions.ts) exists so that
  // a device with Face ID/Touch ID on doesn't get idle-logged-out just for
  // sitting in the background — the whole point of the feature this session
  // was built for (see docs/shift-notification-handoff.md's sibling PR for
  // the shift-notification feature; this one covers biometric session
  // longevity specifically).
  describe("biometric-protected sessions are exempt from idle expiry", () => {
    async function markBiometricProtected(sessionId: string, protectedFlag: boolean) {
      await db.execute({
        sql: "UPDATE user_sessions SET biometric_protected = ? WHERE id = ?",
        args: [protectedFlag ? 1 : 0, sessionId],
      });
    }

    it("keeps authenticating a biometric-protected session well past the ordinary idle timeout", async () => {
      const { token } = await signup("biometric-idle-exempt@example.com");
      const sid = sidOf(token);
      await markBiometricProtected(sid, true);

      await ageSession(sid, SESSION_IDLE_TIMEOUT_MS * 10);

      const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it("still rejects the same session once biometric protection is turned back off", async () => {
      // Proves the exemption is genuinely conditional on the flag, not a
      // side effect of anything else this test file's other cases might
      // share (a fresh session, a fresh user) — flipping the flag off on an
      // otherwise-identical aged session brings the ordinary idle rejection
      // right back.
      const { token } = await signup("biometric-idle-then-off@example.com");
      const sid = sidOf(token);
      await markBiometricProtected(sid, true);
      await ageSession(sid, SESSION_IDLE_TIMEOUT_MS + 60_000);
      expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);

      // The successful request above touched last_seen_at (it was stale
      // past the throttle) — re-age it before flipping protection off, or
      // this would spuriously pass by looking freshly-active rather than by
      // the exemption actually being gone.
      await markBiometricProtected(sid, false);
      await ageSession(sid, SESSION_IDLE_TIMEOUT_MS + 60_000);
      const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it("still rejects a biometric-protected session once its absolute lifetime (expires_at) has passed", async () => {
      // The exemption is narrowly for idle expiry — it must never make a
      // session outlive its own 30-day absolute lifetime.
      const { token } = await signup("biometric-absolute-expiry@example.com");
      const sid = sidOf(token);
      await markBiometricProtected(sid, true);
      await db.execute({
        sql: "UPDATE user_sessions SET expires_at = ? WHERE id = ?",
        args: [new Date(Date.now() - 1000).toISOString(), sid],
      });

      const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it("still rejects a revoked biometric-protected session", async () => {
      const { token } = await signup("biometric-revoked@example.com");
      const sid = sidOf(token);
      await markBiometricProtected(sid, true);
      await db.execute({
        sql: "UPDATE user_sessions SET revoked_at = ? WHERE id = ?",
        args: [new Date().toISOString(), sid],
      });

      const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it("includes an idle-but-biometric-protected session in the sessions list", async () => {
      const { token } = await signup("biometric-idle-listed@example.com");
      const sid = sidOf(token);
      await markBiometricProtected(sid, true);
      await ageSession(sid, SESSION_IDLE_TIMEOUT_MS + 60_000);

      const res = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const ids = (res.body.sessions as { id: string }[]).map((s) => s.id);
      expect(ids).toContain(sid);
    });
  });
});
