import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

// Regression test: authLimiter (20 req/15min) used to be mounted on the
// whole "/api/auth" router, so it caught POST /api/auth/logout along with
// signup/login. A user who burned through that limit on failed login
// attempts would then also get 429 on their own authenticated logout call —
// meaning their session never got revoked server-side even though the
// frontend had already discarded its local token, leaving a copied token
// still valid. authLimiter is now scoped to only /api/auth/signup and
// /api/auth/login (see app.ts); logout instead relies on the general /api
// limiter (300 req/15min) plus requireAuth. This file gets its own
// isolated app/rate-limiter instance (see testApp.ts) specifically so it
// can deliberately exhaust the signup/login limiter without affecting, or
// being affected by, any other test file's auth calls.
describe("auth rate limiter scoping", () => {
  let app: Express;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  const email = "rate-limit-scope@example.com";
  const password = "rate-limit-scope-password-2026";
  let token: string;

  it("signs up successfully, returning a token", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Rate Limit Scope User", email, password, rate: 20 });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    token = res.body.token;
  });

  it("exhausts the shared signup/login limiter (20 requests/15min) with failed login attempts", async () => {
    // The signup above already spent 1 of the 20 (signup and login share
    // one authLimiter instance/bucket — see app.ts). Spend the remaining 19
    // here so the very next signup/login request is the 21st and gets
    // rate-limited.
    for (let i = 0; i < 19; i++) {
      const res = await request(app).post("/api/auth/login").send({ email, password: "definitely-the-wrong-password" });
      expect(res.status).toBe(401);
    }
  });

  it("rejects the next login attempt with 429 once the signup/login limiter is exhausted", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(429);
  });

  it("still returns 204 for authenticated logout, unaffected by the exhausted signup/login limiter", async () => {
    const res = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it("rejects the now-logged-out token with 401 on the next protected request", async () => {
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
