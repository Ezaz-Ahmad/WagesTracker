import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import type { Express } from "express";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("admin effective pay at a local date boundary", () => {
  let app: Express,
    db: Client,
    dbPath: string,
    adminToken: string,
    userId: string;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T15:00:00Z"));
    ({ app, db, dbPath } = await createTestApp());
    const account = await request(app)
      .post("/api/auth/signup")
      .send({
        name: "Local pay",
        email: "local-pay@example.com",
        password: "correct horse battery staple",
        rate: 30,
      });
    userId = account.body.user.id;
    const auth = { Authorization: `Bearer ${account.body.token}` };
    const jobs = await request(app).get("/api/jobs").set(auth);
    const change = await request(app)
      .post(`/api/jobs/${jobs.body.jobs[0].id}/rates`)
      .set(auth)
      .send({ locationId: null, rate: 35, effectiveFrom: "2026-11-22" });
    expect(change.status).toBe(201);
    adminToken = (
      await request(app)
        .post("/api/admin/login")
        .send({ password: "test-admin-password" })
    ).body.token;
  });
  afterAll(() => {
    db?.close();
    cleanupTestDb(dbPath);
    vi.useRealTimers();
  });
  it("shows the new rate on the Sydney date while UTC is still the previous day", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const utc = await request(app)
      .get("/api/admin/users")
      .set(auth)
      .set("X-Client-Time-Zone", "UTC");
    const sydney = await request(app)
      .get("/api/admin/users")
      .set(auth)
      .set("X-Client-Time-Zone", "Australia/Sydney");
    expect(
      utc.body.users.find((u: { id: string }) => u.id === userId).rate
    ).toBe(30);
    expect(
      sydney.body.users.find((u: { id: string }) => u.id === userId).rate
    ).toBe(35);
    const detail = await request(app)
      .get(`/api/admin/users/${userId}`)
      .set(auth)
      .set("X-Client-Time-Zone", "Australia/Sydney");
    expect(detail.body.jobs[0].rate).toBe(35);
  });
});
