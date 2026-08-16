import type { Client } from "@libsql/client";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";
import { BIOMETRIC_SESSION_TTL_MS, SESSION_IDLE_TIMEOUT_MS, SESSION_TTL_MS } from "../src/security/sessionPolicy.js";

// Covers PATCH /api/me/sessions/current, the endpoint the frontend calls when
// biometric login is turned on/off (see AppContext.tsx's
// enableBiometricLoginAction/clearBiometricCredential) to mark/unmark the
// current session as exempt from the idle timeout *and* to move it onto the
// matching absolute lifetime — BIOMETRIC_SESSION_TTL_MS (5 years) while
// protected, SESSION_TTL_MS (30 days, the ordinary default) once it isn't.
//
// A JWT's own expiry is baked in at signing time, so this can't be done by
// flipping a database column in place: the endpoint revokes the caller's
// current session and mints a brand-new one (and a brand-new token for it),
// returned via the X-New-Token response header exactly like
// PATCH /api/me/password does — see session-idle.test.ts's
// "biometric-protected sessions are exempt from idle expiry" block for the
// validateSession-level exemption this endpoint's flag drives.
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

  async function expiresAtOf(sessionId: string): Promise<number> {
    const row = await db.execute({ sql: "SELECT expires_at FROM user_sessions WHERE id = ?", args: [sessionId] });
    return new Date(String((row.rows[0] as unknown as { expires_at: string }).expires_at)).getTime();
  }

  /** PATCHes biometricProtected and returns the replacement token from
   * X-New-Token — every test below must switch to this token for its next
   * request, since the one that made this call was just revoked. */
  async function patchProtection(token: string, protectedFlag: boolean): Promise<{ status: number; newToken: string | undefined }> {
    const res = await request(app)
      .patch("/api/me/sessions/current")
      .set("Authorization", `Bearer ${token}`)
      .send({ biometricProtected: protectedFlag });
    return { status: res.status, newToken: res.headers["x-new-token"] };
  }

  it("marking the current session protected returns a replacement token and exempts it from the idle timeout", async () => {
    const { token } = await signup("mark-protected@example.com");

    const { status, newToken } = await patchProtection(token, true);
    expect(status).toBe(204);
    expect(typeof newToken).toBe("string");

    await ageSession(sidOf(newToken!), SESSION_IDLE_TIMEOUT_MS + 60_000);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${newToken}`)).status).toBe(200);
  });

  it("revokes the old token as part of the rotation — it stops authenticating immediately", async () => {
    // This is the whole reason the endpoint can't just flip a column: a JWT
    // minted with the ordinary 30-day expiry can never be stretched to 5
    // years after the fact, so a genuinely longer-lived credential has to be
    // a new token — which means the old one backing the same physical
    // session has to go, in the same breath, so there is never a moment
    // where both are simultaneously valid.
    const { token } = await signup("old-token-revoked@example.com");

    const { newToken } = await patchProtection(token, true);
    expect(newToken).toBeTruthy();

    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${newToken}`)).status).toBe(200);
  });

  it("sets the new session's absolute expiry to the 5-year biometric lifetime, not the ordinary 30 days", async () => {
    const { token } = await signup("five-year-expiry@example.com");
    const before = Date.now();

    const { newToken } = await patchProtection(token, true);
    const expiresAt = await expiresAtOf(sidOf(newToken!));

    // Generous tolerance for the request's own wall-clock time, not for
    // anything approximate about the duration itself.
    expect(expiresAt).toBeGreaterThan(before + BIOMETRIC_SESSION_TTL_MS - 60_000);
    expect(expiresAt).toBeLessThan(before + BIOMETRIC_SESSION_TTL_MS + 60_000);
    // Sanity check against the ordinary lifetime, so a regression that wires
    // this up to the wrong constant fails loudly rather than by a hair.
    expect(expiresAt).toBeGreaterThan(before + SESSION_TTL_MS * 10);
  });

  it("unmarking rotates back onto the ordinary 30-day lifetime and restores the idle timeout", async () => {
    const { token } = await signup("unmark-protected@example.com");

    const first = await patchProtection(token, true);
    const before = Date.now();
    const second = await patchProtection(first.newToken!, false);
    expect(second.status).toBe(204);
    const sid = sidOf(second.newToken!);

    const expiresAt = await expiresAtOf(sid);
    expect(expiresAt).toBeGreaterThan(before + SESSION_TTL_MS - 60_000);
    expect(expiresAt).toBeLessThan(before + SESSION_TTL_MS + 60_000);

    await ageSession(sid, SESSION_IDLE_TIMEOUT_MS + 60_000);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${second.newToken}`)).status).toBe(401);
  });

  it("only ever affects the caller's own current session, never another one by id or another user's", async () => {
    const a = await signup("scope-a@example.com");
    const b = await signup("scope-b@example.com");

    await patchProtection(a.token, true);

    await ageSession(sidOf(b.token), SESSION_IDLE_TIMEOUT_MS + 60_000);
    // B's session was never touched by A's request — still ordinary idle
    // rules, and B's original token is still the live one (never rotated).
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${b.token}`)).status).toBe(401);
  });

  it("rejects a non-boolean body instead of silently coercing it, and never rotates the session", async () => {
    const { token } = await signup("bad-body@example.com");
    const res = await request(app)
      .patch("/api/me/sessions/current")
      .set("Authorization", `Bearer ${token}`)
      .send({ biometricProtected: "yes" });
    expect(res.status).toBe(400);
    expect(res.headers["x-new-token"]).toBeUndefined();

    // The original token must still be the live one — a rejected request
    // must never have revoked anything on its way to the 400.
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("requires authentication", async () => {
    const res = await request(app).patch("/api/me/sessions/current").send({ biometricProtected: true });
    expect(res.status).toBe(401);
  });

  it("is reflected in the sessions list as biometricProtected, using the replacement token", async () => {
    const { token } = await signup("listed-flag@example.com");

    const { newToken } = await patchProtection(token, true);

    const list = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${newToken}`);
    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.sessions[0].biometricProtected).toBe(true);
    expect(list.body.sessions[0].isCurrent).toBe(true);
  });

  it("carries over the device installation id, so the sessions list still shows one entry per device rather than a duplicate", async () => {
    const { userId } = await signup("carry-installation@example.com");
    const installationId = "9c858901-8a57-4791-81fe-4c455b099bc9";
    const login = await request(app)
      .post("/api/auth/login")
      .send({
        email: "carry-installation@example.com",
        password: "biometric-protection-password-2026",
        deviceInstallationId: installationId,
      });
    const token = login.body.token as string;

    const { newToken } = await patchProtection(token, true);

    const row = await db.execute({
      sql: "SELECT device_installation_id FROM user_sessions WHERE id = ?",
      args: [sidOf(newToken!)],
    });
    expect((row.rows[0] as unknown as { device_installation_id: string }).device_installation_id).toBe(
      installationId
    );
    expect(userId).toBeTruthy();
  });
});
