import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("me (profile/settings)", () => {
  let app: Express;
  let dbPath: string;
  let token: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Settings User", email: "settings@example.com", password: "password-1", rate: 20 });
    token = signup.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("returns the authenticated user's public profile", async () => {
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Settings User");
    expect(res.body.user.email).toBe("settings@example.com");
    expect(res.body.user.rate).toBe(20);
    // Never returns the password hash.
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it("saves valid settings changes and reflects them on a later GET", async () => {
    const patch = await request(app)
      .patch("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name", rate: 27.5, goalHours: 30, goalEarnings: 825, weekStartsOn: "Sunday" });
    expect(patch.status).toBe(200);
    expect(patch.body.user.name).toBe("Updated Name");
    expect(patch.body.user.rate).toBe(27.5);
    expect(patch.body.user.goalHours).toBe(30);
    expect(patch.body.user.goalEarnings).toBe(825);
    expect(patch.body.user.weekStartsOn).toBe("Sunday");
    // Settings PATCH responses never leak the hash either.
    expect(patch.body.user.password_hash).toBeUndefined();

    const after = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(after.body.user.name).toBe("Updated Name");
    expect(after.body.user.rate).toBe(27.5);
  });

  it("rejects a negative hourly rate", async () => {
    const res = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ rate: -5 });
    expect(res.status).toBe(400);
  });

  it("rejects an hourly rate above the sane upper bound", async () => {
    const res = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ rate: 5000 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative weekly hours goal", async () => {
    const res = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ goalHours: -10 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative weekly earnings goal", async () => {
    const res = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ goalEarnings: -100 });
    expect(res.status).toBe(400);
  });
});
