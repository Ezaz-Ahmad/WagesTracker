import type { Client } from "@libsql/client";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";
import { MAX_ACTIVE_INSTALLATIONS } from "../src/security/sessionPolicy.js";

/**
 * Per-installation session identity — the fix for a sessions list that grew
 * one identical "Safari on iOS" entry per login from the same phone.
 *
 * The distinction these tests exist to protect is that device identity comes
 * from a client-generated installation UUID and *nothing else*. IP address
 * and user-agent are display detail: two phones on one Wi-Fi share an IP and
 * can send byte-identical user-agent strings, and one phone changes IP
 * whenever it moves between Wi-Fi and mobile data. Any implementation that
 * quietly starts inferring device identity from those would pass a naive
 * "no duplicates" test and fail these.
 *
 * Its own file/app instance, like the other session suites, so the combined
 * signup/login calls don't trip the auth rate limiter (20 req/15 min).
 */
describe("per-installation sessions", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  const PASSWORD = "installation-session-password-2026";

  function decode(token: string): { sub: string; sid: string } {
    return jwt.decode(token) as { sub: string; sid: string };
  }

  // The signup/login rate limiter (20 req/15min) is keyed by client IP, and
  // `trust proxy` means that IP comes from X-Forwarded-For — so giving each
  // call its own source address keeps this file's many logins from throttling
  // each other, without loosening the limiter that protects real users. Tests
  // that care about the IP pass one explicitly.
  let ipCounter = 0;
  function uniqueIp(): string {
    ipCounter += 1;
    return `10.${Math.floor(ipCounter / 65536) % 256}.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  }

  async function signup(email: string, deviceInstallationId?: string, ip: string = uniqueIp()) {
    return request(app)
      .post("/api/auth/signup")
      .set("X-Forwarded-For", ip)
      .send({ name: "Install Test", email, password: PASSWORD, rate: 20, deviceInstallationId });
  }

  async function login(email: string, deviceInstallationId?: string, ip: string = uniqueIp()) {
    return request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email, password: PASSWORD, deviceInstallationId });
  }

  /** Active = what the server would actually accept: unrevoked and unexpired. */
  async function activeSessionCount(userId: string): Promise<number> {
    const result = await db.execute({
      sql: "SELECT COUNT(*) as n FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?",
      args: [userId, new Date().toISOString()],
    });
    return Number((result.rows[0] as unknown as { n: number }).n);
  }

  it("leaves exactly one active session after repeated logins from the same installation", async () => {
    const installation = randomUUID();
    const email = "repeat-login@example.com";
    const signupRes = await signup(email, installation);
    const userId = signupRes.body.user.id as string;

    for (let i = 0; i < 5; i += 1) {
      const res = await login(email, installation);
      expect(res.status).toBe(200);
    }

    expect(await activeSessionCount(userId)).toBe(1);
  });

  it("invalidates the previous token for that installation rather than reusing it", async () => {
    const installation = randomUUID();
    const email = "rotation@example.com";
    await signup(email, installation);

    const first = await login(email, installation);
    const second = await login(email, installation);

    // A brand-new session, not the old one handed back.
    expect(decode(second.body.token).sid).not.toBe(decode(first.body.token).sid);
    expect(second.body.token).not.toBe(first.body.token);

    // And the old one is dead immediately, not merely forgotten client-side.
    const withOld = await request(app).get("/api/me").set("Authorization", `Bearer ${first.body.token}`);
    expect(withOld.status).toBe(401);
    const withNew = await request(app).get("/api/me").set("Authorization", `Bearer ${second.body.token}`);
    expect(withNew.status).toBe(200);
  });

  it("keeps two installations separate even with identical user agents", async () => {
    const email = "two-installs@example.com";
    const phone = randomUUID();
    const tablet = randomUUID();
    const signupRes = await signup(email, phone);
    const userId = signupRes.body.user.id as string;

    const sameUserAgent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
    await request(app)
      .post("/api/auth/login")
      .set("User-Agent", sameUserAgent)
      .set("X-Forwarded-For", uniqueIp())
      .send({ email, password: PASSWORD, deviceInstallationId: phone });
    await request(app)
      .post("/api/auth/login")
      .set("User-Agent", sameUserAgent)
      .set("X-Forwarded-For", uniqueIp())
      .send({ email, password: PASSWORD, deviceInstallationId: tablet });

    expect(await activeSessionCount(userId)).toBe(2);
  });

  it("does not create a duplicate when the same installation changes IP address", async () => {
    const installation = randomUUID();
    const email = "roaming@example.com";
    const signupRes = await signup(email, installation);
    const userId = signupRes.body.user.id as string;

    // Home Wi-Fi, then mobile data, then a café — one device throughout.
    await login(email, installation, "203.0.113.10");
    await login(email, installation, "198.51.100.55");
    await login(email, installation, "192.0.2.77");

    expect(await activeSessionCount(userId)).toBe(1);
  });

  it("keeps two devices behind one shared IP separate", async () => {
    const email = "shared-ip@example.com";
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const signupRes = await signup(email, deviceA);
    const userId = signupRes.body.user.id as string;

    await login(email, deviceA, "203.0.113.10");
    await login(email, deviceB, "203.0.113.10");

    expect(await activeSessionCount(userId)).toBe(2);
  });

  it("never lets one user's installation id touch another user's sessions", async () => {
    const shared = randomUUID();
    const alice = "alice-install@example.com";
    const bob = "bob-install@example.com";
    const aliceRes = await signup(alice, shared);
    const bobRes = await signup(bob, shared);

    // Same installation id, different accounts: neither is affected by the
    // other, because every lookup is scoped by user_id.
    await login(alice, shared);
    expect(await activeSessionCount(aliceRes.body.user.id)).toBe(1);
    expect(await activeSessionCount(bobRes.body.user.id)).toBe(1);

    // Bob's token still works after Alice logged in on "the same" installation.
    const bobMe = await request(app).get("/api/me").set("Authorization", `Bearer ${bobRes.body.token}`);
    expect(bobMe.status).toBe(200);
  });

  it("rejects a malformed or oversized installation id instead of storing it", async () => {
    const email = "malformed@example.com";
    await signup(email, randomUUID());

    for (const bad of ["not-a-uuid", "", "x".repeat(500), "../../etc/passwd", "12345"]) {
      const res = await login(email, bad);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/installation id/i);
    }

    const stored = await db.execute("SELECT device_installation_id FROM user_sessions");
    for (const row of stored.rows) {
      const value = (row as unknown as { device_installation_id: string | null }).device_installation_id;
      if (value !== null) expect(value).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it("still logs in, undeduplicated, when no installation id is sent at all", async () => {
    // An older client must keep working rather than being locked out.
    const email = "legacy-client@example.com";
    const signupRes = await signup(email);
    const userId = signupRes.body.user.id as string;

    await login(email);
    await login(email);

    expect(await activeSessionCount(userId)).toBe(3);
    const rows = await db.execute({
      sql: "SELECT device_installation_id FROM user_sessions WHERE user_id = ?",
      args: [userId],
    });
    for (const row of rows.rows) {
      expect((row as unknown as { device_installation_id: string | null }).device_installation_id).toBeNull();
    }
  });

  it("does not leave duplicates when the same installation logs in concurrently", async () => {
    const installation = randomUUID();
    const email = "concurrent@example.com";
    const signupRes = await signup(email, installation);
    const userId = signupRes.body.user.id as string;

    // Fired together, deliberately: a plain SELECT-then-INSERT would let two
    // of these both decide there was nothing to revoke.
    const results = await Promise.all([
      login(email, installation),
      login(email, installation),
      login(email, installation),
    ]);
    for (const res of results) expect(res.status).toBe(200);

    expect(await activeSessionCount(userId)).toBe(1);
  });

  it("carries the installation id onto the replacement session after a password change", async () => {
    const installation = randomUUID();
    const email = "pw-change-install@example.com";
    await signup(email, installation);
    const loggedIn = await login(email, installation);
    const userId = loggedIn.body.user.id as string;

    const newPassword = "changed-installation-password-2026";
    const change = await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${loggedIn.body.token}`)
      .send({ currentPassword: PASSWORD, newPassword });
    expect(change.status).toBe(204);

    const replacement = change.headers["x-new-token"] as string;
    const { sid } = decode(replacement);
    const row = await db.execute({ sql: "SELECT * FROM user_sessions WHERE id = ?", args: [sid] });
    expect((row.rows[0] as unknown as { device_installation_id: string }).device_installation_id).toBe(installation);

    // ...so the next login from this device rotates rather than duplicating.
    await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", uniqueIp())
      .send({ email, password: newPassword, deviceInstallationId: installation });
    expect(await activeSessionCount(userId)).toBe(1);
  });

  it("signs out the least-recently-active device once the installation limit is passed", async () => {
    const email = "device-limit@example.com";
    const installations = Array.from({ length: MAX_ACTIVE_INSTALLATIONS }, () => randomUUID());
    const signupRes = await signup(email, installations[0]);
    const userId = signupRes.body.user.id as string;

    for (const installation of installations.slice(1)) {
      await login(email, installation);
    }
    expect(await activeSessionCount(userId)).toBe(MAX_ACTIVE_INSTALLATIONS);

    // The oldest active session is the signup one — nothing has touched it since.
    const oldest = await db.execute({
      sql: `SELECT id FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL
            ORDER BY last_seen_at ASC LIMIT 1`,
      args: [userId],
    });
    const oldestId = String((oldest.rows[0] as unknown as { id: string }).id);

    const overflow = await login(email, randomUUID());
    expect(overflow.status).toBe(200);
    // Explained, not silent.
    expect(overflow.body.notice).toMatch(/signed out/i);

    expect(await activeSessionCount(userId)).toBe(MAX_ACTIVE_INSTALLATIONS);
    const evicted = await db.execute({ sql: "SELECT revoked_at FROM user_sessions WHERE id = ?", args: [oldestId] });
    expect((evicted.rows[0] as unknown as { revoked_at: string | null }).revoked_at).not.toBeNull();
  });

  it("never exposes the installation id through the sessions API", async () => {
    const installation = randomUUID();
    const email = "no-leak@example.com";
    await signup(email, installation);
    const loggedIn = await login(email, installation);

    const res = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${loggedIn.body.token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(installation);
    expect(body).not.toContain("device_installation_id");
    expect(body).not.toContain("deviceInstallationId");
    expect(body).not.toContain(loggedIn.body.token);
  });

  it("returns the current session first, then others newest-active first", async () => {
    const email = "ordering@example.com";
    const first = randomUUID();
    await signup(email, first);
    await login(email, randomUUID());
    await login(email, randomUUID());
    const current = await login(email, first);

    const res = await request(app).get("/api/me/sessions").set("Authorization", `Bearer ${current.body.token}`);
    expect(res.status).toBe(200);
    const sessions = res.body.sessions as { id: string; isCurrent: boolean; lastActiveAt: string }[];
    expect(sessions.length).toBeGreaterThan(1);
    expect(sessions[0].isCurrent).toBe(true);
    expect(sessions[0].id).toBe(decode(current.body.token).sid);

    const rest = sessions.slice(1);
    for (let i = 1; i < rest.length; i += 1) {
      expect(rest[i - 1].lastActiveAt >= rest[i].lastActiveAt).toBe(true);
    }
  });
});
