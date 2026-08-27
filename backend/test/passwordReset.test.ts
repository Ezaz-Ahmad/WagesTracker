import type { Client } from "@libsql/client";
import type { Express } from "express";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

const NEUTRAL = "If an account exists for this email, we've sent password reset instructions.";

describe("password recovery", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let outbox: { to: string; subject: string; text: string; html: string; tag?: string }[];
  let waitForEmail: () => Promise<void>;
  let hashPassword: (password: string) => Promise<string>;
  let accountCounter = 0;

  beforeAll(async () => {
    process.env.RATE_LIMIT_FORGOT_PASSWORD_IP = "500";
    process.env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL = "500";
    process.env.RATE_LIMIT_RESET_PASSWORD = "500";
    ({ app, db, dbPath } = await createTestApp());
    ({ waitForPendingPasswordResetEmails: waitForEmail } = await import("../src/routes/passwordReset.js"));
    ({ hashPassword } = await import("../src/security/passwordHashing.js"));
    const transport = await import("../src/email/transport.js");
    outbox = transport.testOutbox.outbox;
  });

  beforeEach(() => {
    outbox.length = 0;
  });

  afterAll(async () => {
    await waitForEmail();
    delete process.env.RATE_LIMIT_FORGOT_PASSWORD_IP;
    delete process.env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL;
    delete process.env.RATE_LIMIT_RESET_PASSWORD;
    cleanupTestDb(dbPath);
  });

  async function createAccount(password = "the-original-passphrase-2026") {
    accountCounter += 1;
    const id = randomUUID();
    const email = `reset-${accountCounter}@example.com`;
    const name = `Reset User ${accountCounter}`;
    await db.execute({
      sql: `INSERT INTO users (id, name, email, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, name, email, await hashPassword(password), new Date().toISOString()],
    });
    return { id, email, name, password };
  }

  async function requestReset(email: string) {
    const response = await request(app).post("/api/auth/forgot-password").send({ email });
    await waitForEmail();
    return response;
  }

  function latestToken(email: string): string {
    const message = [...outbox].reverse().find((candidate) => candidate.to === email && candidate.tag === "password-reset");
    if (!message) throw new Error(`No reset email found for ${email}`);
    const match = /\/reset-password#token=([^\s"'<>&]+)/.exec(message.text);
    if (!match) throw new Error("Reset email did not contain a fragment token.");
    return decodeURIComponent(match[1]);
  }

  async function liveSession(email: string, password: string, ipSuffix: number) {
    const login = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `198.51.100.${ipSuffix}`)
      .send({ email, password });
    expect(login.status).toBe(200);
    return login.body.token as string;
  }

  it("returns the exact same response for known, unknown, malformed, and differently-cased addresses", async () => {
    const account = await createAccount();
    for (const email of [account.email, "missing@example.com", "not-an-email", account.email.toUpperCase()]) {
      const response = await requestReset(email);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: NEUTRAL });
    }
    expect(outbox.filter((message) => message.tag === "password-reset")).toHaveLength(2);
  });

  it("never returns or stores the raw token, and puts it in a URL fragment", async () => {
    const account = await createAccount();
    const response = await requestReset(account.email);
    const rawToken = latestToken(account.email);
    expect(JSON.stringify(response.body)).not.toContain(rawToken);
    expect(outbox[0].text).toContain("/reset-password#token=");
    expect(outbox[0].text).not.toContain("/reset-password?token=");

    const rawLookup = await db.execute({ sql: "SELECT 1 FROM password_reset_tokens WHERE token_hash = ?", args: [rawToken] });
    expect(rawLookup.rows).toHaveLength(0);
    const hashLookup = await db.execute({
      sql: "SELECT user_id FROM password_reset_tokens WHERE token_hash = ?",
      args: [createHash("sha256").update(rawToken).digest("hex")],
    });
    expect(hashLookup.rows).toHaveLength(1);
    expect(String((hashLookup.rows[0] as unknown as { user_id: string }).user_id)).toBe(account.id);
  });

  it("responds without waiting for a slow mail provider", async () => {
    const account = await createAccount();
    const transport = await import("../src/email/transport.js");
    let finishDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => {
      finishDelivery = resolve;
    });
    const send = vi.spyOn(transport.testOutbox, "send").mockImplementationOnce(() => deliveryGate);
    let responseTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const response = await Promise.race([
        request(app).post("/api/auth/forgot-password").send({ email: account.email }),
        new Promise<never>((_resolve, reject) => {
          responseTimer = setTimeout(() => reject(new Error("Forgot-password response waited for email delivery.")), 2_000);
        }),
      ]);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: NEUTRAL });
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    } finally {
      if (responseTimer) clearTimeout(responseTimer);
      finishDelivery();
      await waitForEmail();
      send.mockRestore();
    }
  });

  it("supersedes an older link and validates without consuming the newer one", async () => {
    const account = await createAccount();
    await requestReset(account.email);
    const older = latestToken(account.email);
    await requestReset(account.email);
    const newer = latestToken(account.email);
    expect(newer).not.toBe(older);

    await request(app).post("/api/auth/reset-password/validate").send({ token: older }).expect(400);
    await request(app).post("/api/auth/reset-password/validate").send({ token: newer }).expect(200);
    await request(app).post("/api/auth/reset-password/validate").send({ token: newer }).expect(200);
  });

  it("does not burn the link for a weak or unchanged new password", async () => {
    const account = await createAccount();
    await requestReset(account.email);
    const token = latestToken(account.email);

    const weak = await request(app).post("/api/auth/reset-password").send({ token, password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatch(/at least 15 characters/i);

    const unchanged = await request(app).post("/api/auth/reset-password").send({ token, password: account.password });
    expect(unchanged.status).toBe(400);
    expect(unchanged.body.error).toMatch(/must be different/i);
    await request(app).post("/api/auth/reset-password/validate").send({ token }).expect(200);
  });

  it("replaces the password, rejects the old one, and allows the new one", async () => {
    const account = await createAccount();
    const replacement = "a-brand-new-passphrase-2026";
    await requestReset(account.email);
    const token = latestToken(account.email);

    const reset = await request(app).post("/api/auth/reset-password").send({ token, password: replacement });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ message: "Your password has been reset. You can now log in with your new password." });
    expect(JSON.stringify(reset.body)).not.toContain(account.email);

    await request(app).post("/api/auth/login").send({ email: account.email, password: account.password }).expect(401);
    await request(app).post("/api/auth/login").send({ email: account.email, password: replacement }).expect(200);
  });

  it("consumes a token exactly once, including simultaneous submissions", async () => {
    const account = await createAccount();
    await requestReset(account.email);
    const token = latestToken(account.email);
    const [first, second] = await Promise.all([
      request(app).post("/api/auth/reset-password").send({ token, password: "first-winning-passphrase-2026" }),
      request(app).post("/api/auth/reset-password").send({ token, password: "second-racing-passphrase-2026" }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const rejected = first.status === 400 ? first : second;
    expect(rejected.body.code).toBe("INVALID_RESET_TOKEN");
  });

  it("rejects expired and malformed credentials with one generic response", async () => {
    const account = await createAccount();
    await requestReset(account.email);
    const token = latestToken(account.email);
    await db.execute({
      sql: "UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?",
      args: [new Date(Date.now() - 60_000).toISOString(), createHash("sha256").update(token).digest("hex")],
    });

    for (const candidate of [token, "", "!!!!", "x".repeat(600), "../../etc/passwd"]) {
      const response = await request(app)
        .post("/api/auth/reset-password")
        .send({ token: candidate, password: "a-valid-replacement-passphrase-2026" });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_RESET_TOKEN");
      expect(JSON.stringify(response.body)).not.toMatch(/sql|sqlite|password_reset_tokens|stack/i);
    }
  });

  it("revokes every session and invalidates JWTs issued before recovery", async () => {
    const account = await createAccount();
    const first = await liveSession(account.email, account.password, 31);
    const second = await liveSession(account.email, account.password, 32);
    await request(app).get("/api/me").set("Authorization", `Bearer ${first}`).expect(200);
    await request(app).get("/api/me").set("Authorization", `Bearer ${second}`).expect(200);

    await requestReset(account.email);
    const token = latestToken(account.email);
    await request(app).post("/api/auth/reset-password").send({ token, password: "sessions-revoked-passphrase-2026" }).expect(200);

    await request(app).get("/api/me").set("Authorization", `Bearer ${first}`).expect(401);
    await request(app).get("/api/me").set("Authorization", `Bearer ${second}`).expect(401);
    const sessions = await db.execute({ sql: "SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL", args: [account.id] });
    expect(Number((sessions.rows[0] as unknown as { n: number }).n)).toBe(0);
    const user = await db.execute({ sql: "SELECT token_version FROM users WHERE id = ?", args: [account.id] });
    expect(Number((user.rows[0] as unknown as { token_version: number }).token_version)).toBe(1);
  });

  it("invalidates an outstanding reset link after authenticated password change", async () => {
    const account = await createAccount();
    const session = await liveSession(account.email, account.password, 41);
    await requestReset(account.email);
    const token = latestToken(account.email);

    await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${session}`)
      .send({ currentPassword: account.password, newPassword: "authenticated-change-passphrase-2026" })
      .expect(204);

    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "should-not-be-accepted-passphrase-2026" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_RESET_TOKEN");
  });

  it("sends a security notification without including either password", async () => {
    const account = await createAccount();
    const replacement = "notification-replacement-passphrase-2026";
    await requestReset(account.email);
    const token = latestToken(account.email);
    await request(app).post("/api/auth/reset-password").send({ token, password: replacement }).expect(200);

    const notice = outbox.find((message) => message.tag === "password-changed");
    expect(notice?.subject).toBe("Your Wage Tracker password was changed");
    for (const body of [notice?.text ?? "", notice?.html ?? ""]) {
      expect(body).not.toContain(account.password);
      expect(body).not.toContain(replacement);
    }
  });

  it("keeps a delivery failure neutral and logs no address or token", async () => {
    const account = await createAccount();
    const transport = await import("../src/email/transport.js");
    const send = vi.spyOn(transport.testOutbox, "send").mockRejectedValueOnce(new Error(`secret ${account.email}`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await requestReset(account.email);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: NEUTRAL });
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(account.email);
    const tokens = await db.execute({ sql: "SELECT invalidated_at FROM password_reset_tokens WHERE user_id = ?", args: [account.id] });
    expect(tokens.rows).toHaveLength(1);
    expect((tokens.rows[0] as unknown as { invalidated_at: string | null }).invalidated_at).not.toBeNull();

    send.mockRestore();
    consoleError.mockRestore();
  });
});
