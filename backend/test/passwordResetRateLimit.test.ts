import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PASSWORD_RECOVERY_RATE_LIMITS } from "../src/security/rateLimitPolicy.js";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("password recovery rate limits", () => {
  let app: Express;
  let dbPath: string;
  let waitForEmail: () => Promise<void>;

  beforeAll(async () => {
    delete process.env.RATE_LIMIT_FORGOT_PASSWORD_IP;
    delete process.env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL;
    delete process.env.RATE_LIMIT_RESET_PASSWORD;
    ({ app, dbPath } = await createTestApp());
    ({ waitForPendingPasswordResetEmails: waitForEmail } = await import("../src/routes/passwordReset.js"));
  });

  afterAll(async () => {
    await waitForEmail();
    cleanupTestDb(dbPath);
  });

  it("ships with intentionally tight production limits", () => {
    expect(PASSWORD_RECOVERY_RATE_LIMITS.forgotPasswordPerIp.limit).toBeLessThanOrEqual(10);
    expect(PASSWORD_RECOVERY_RATE_LIMITS.forgotPasswordPerEmail.limit).toBeLessThanOrEqual(5);
    expect(PASSWORD_RECOVERY_RATE_LIMITS.forgotPasswordPerEmail.windowMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it("stops one host from walking a list of addresses without affecting another host", async () => {
    const limit = PASSWORD_RECOVERY_RATE_LIMITS.forgotPasswordPerIp.limit;
    for (let index = 0; index < limit; index += 1) {
      await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", "192.0.2.10")
        .send({ email: `probe-${index}@example.com` })
        .expect(200);
    }
    await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.10")
      .send({ email: "blocked@example.com" })
      .expect(429);
    await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.11")
      .send({ email: "fresh-host@example.com" })
      .expect(200);
  });

  it("stops one address being flooded from many different hosts", async () => {
    const email = "mail-flood@example.com";
    const limit = PASSWORD_RECOVERY_RATE_LIMITS.forgotPasswordPerEmail.limit;
    for (let index = 0; index < limit; index += 1) {
      await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", `192.0.2.${100 + index}`)
        .send({ email })
        .expect(200);
    }
    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.200")
      .send({ email });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Too many attempts. Please try again later.");
  });

  it("limits reset-token guesses independently", async () => {
    const limit = PASSWORD_RECOVERY_RATE_LIMITS.resetPassword.limit;
    for (let index = 0; index < limit; index += 1) {
      await request(app)
        .post("/api/auth/reset-password/validate")
        .set("X-Forwarded-For", "192.0.2.50")
        .send({ token: `guess-${index}` })
        .expect(400);
    }
    await request(app)
      .post("/api/auth/reset-password/validate")
      .set("X-Forwarded-For", "192.0.2.50")
      .send({ token: "guess-final" })
      .expect(429);
  });
});
