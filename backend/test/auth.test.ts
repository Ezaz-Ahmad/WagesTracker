import type { Express } from "express";
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
    password: "correct-horse",
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

  it("rejects a duplicate email", async () => {
    const res = await request(app).post("/api/auth/signup").send(validSignup);
    expect(res.status).toBe(409);
  });

  it("logs in with the correct password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validSignup.email, password: validSignup.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe(validSignup.email);
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
});
