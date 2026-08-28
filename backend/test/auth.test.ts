import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("auth", () => {
  let app: Express;
  let dbPath: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
  });
  afterAll(() => cleanupTestDb(dbPath));

  const validSignup = {
    name: "Alex Rivera",
    email: "alex@example.com",
    password: "alex-signup-flow-2026",
    rate: 20,
  };

  it("signs up with valid details", async () => {
    const res = await request(app).post("/api/auth/signup").send(validSignup);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe(validSignup.email);
    expect(res.body.user.rate).toBe(20);
    // Never echo the hash (or a raw "password" field) back to the client.
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it("rejects signup with an invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...validSignup, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects signup with too short a password", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...validSignup, email: "shortpw@example.com", password: "abc" });
    expect(res.status).toBe(400);
  });

  it("rejects signup missing a name", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...validSignup, email: "noname@example.com", name: "" });
    expect(res.status).toBe(400);
  });

  it("requires a positive, bounded hourly rate with no more than two decimals", async () => {
    for (const [email, rate] of [
      ["missing-rate@example.com", undefined],
      ["zero-rate@example.com", 0],
      ["negative-rate@example.com", -1],
      ["precise-rate@example.com", 20.123],
      ["large-rate@example.com", 1000.01],
      ["string-rate@example.com", "25.00"],
    ] as const) {
      const body = { ...validSignup, email, rate };
      if (rate === undefined) delete (body as { rate?: unknown }).rate;
      const res = await request(app).post("/api/auth/signup").send(body);
      expect(res.status, `${email} should be rejected`).toBe(400);
    }
  });

  it("rejects a duplicate email", async () => {
    const res = await request(app).post("/api/auth/signup").send(validSignup);
    expect(res.status).toBe(409);
  });

  it("logs in with the correct password, without ever returning the password/hash", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validSignup.email, password: validSignup.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe(validSignup.email);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it("normalizes email case — signup with a mixed-case email logs in with any casing", async () => {
    const email = "MixedCase@Example.com";
    const password = "case-sensitivity-check-2026";
    const signup = await request(app).post("/api/auth/signup").send({ name: "Case Test", email, password, rate: 15 });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe(email.toLowerCase());

    const loginLower = await request(app).post("/api/auth/login").send({ email: email.toLowerCase(), password });
    expect(loginLower.status).toBe(200);

    const loginUpper = await request(app).post("/api/auth/login").send({ email: email.toUpperCase(), password });
    expect(loginUpper.status).toBe(200);
  });

  it("rejects login with the wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validSignup.email, password: "totally-wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects login for an email that was never signed up", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "whatever1" });
    expect(res.status).toBe(401);
  });

  it("blocks an unauthenticated request to a protected route", async () => {
    const res = await request(app).get("/api/shifts");
    expect(res.status).toBe(401);
  });

  it("blocks a request carrying a garbage/forged token", async () => {
    const res = await request(app).get("/api/shifts").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("blocks a request carrying an expired JWT", async () => {
    // Signed with the same secret createTestApp put in process.env.JWT_SECRET
    // (so it's cryptographically valid) but already expired — this is the
    // "the signature checks out, but the clock doesn't" case, distinct from
    // the garbage-token test above.
    const expiredToken = jwt.sign({ sub: "some-user-id" }, process.env.JWT_SECRET!, { expiresIn: "-10s" });
    const res = await request(app).get("/api/shifts").set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });
});
