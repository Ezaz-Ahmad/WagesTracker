import type { Client } from "@libsql/client";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("admin", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let regularUserToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Regular User", email: "regular@example.com", password: "admin-regular-user-2026", rate: 20 });
    regularUserToken = signup.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("returns an admin JWT for the correct admin password", async () => {
    const res = await request(app).post("/api/admin/login").send({ password: process.env.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
    adminToken = res.body.token;
  });

  it("rejects an incorrect admin password", async () => {
    const res = await request(app).post("/api/admin/login").send({ password: "definitely-wrong" });
    expect(res.status).toBe(401);
  });

  it("blocks a regular user's JWT from reaching admin routes", async () => {
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${regularUserToken}`);
    // Distinct from the "no token at all" case (401) — this token is
    // perfectly valid, it's just not an admin token, so it's a 403.
    expect(res.status).toBe(403);
  });

  it("blocks a forged/garbage admin token", async () => {
    const res = await request(app).get("/api/admin/users").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("blocks an expired admin token", async () => {
    const expiredAdminToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET!, { expiresIn: "-10s" });
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${expiredAdminToken}`);
    expect(res.status).toBe(401);
  });

  it("never exposes password hashes in admin user list/detail responses", async () => {
    const list = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.users.length).toBeGreaterThan(0);
    for (const u of list.body.users) {
      expect(u.password).toBeUndefined();
      expect(u.password_hash).toBeUndefined();
    }

    const regularUserId = list.body.users.find((u: { email: string }) => u.email === "regular@example.com").id;
    const detail = await request(app).get(`/api/admin/users/${regularUserId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.user.password).toBeUndefined();
    expect(detail.body.user.password_hash).toBeUndefined();
  });

  it("deletes a user and every row referencing them across all five tables, including their sessions", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Deletable Via Admin", email: "admin-deletes-me@example.com", password: "admin-deletable-user-2026", rate: 18 });
    const targetToken = signup.body.token;
    const targetId = signup.body.user.id;

    // Signup already creates one session row for this user (see
    // backend/src/routes/auth.ts) — log in again too, so there's more than
    // one session row to prove the delete isn't just clearing a single row
    // by coincidence.
    await request(app).post("/api/auth/login").send({ email: "admin-deletes-me@example.com", password: "admin-deletable-user-2026" });

    await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${targetToken}`)
      .send({ date: "2026-01-05", signIn: "09:00", signOut: "17:00" });
    await request(app).put("/api/day-expenses/2026-01-05").set("Authorization", `Bearer ${targetToken}`).send({ fuelCost: 10 });
    await request(app)
      .put("/api/week-extras/2026-01-05")
      .set("Authorization", `Bearer ${targetToken}`)
      .send({ amount: 25, reason: "Bonus" });

    const sessionsBefore = await db.execute({ sql: "SELECT COUNT(*) as c FROM user_sessions WHERE user_id = ?", args: [targetId] });
    expect(Number(sessionsBefore.rows[0].c)).toBeGreaterThanOrEqual(2);

    const del = await request(app).delete(`/api/admin/users/${targetId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(204);

    const [users, shifts, dayExpenses, weekExtras, sessions] = await Promise.all([
      db.execute({ sql: "SELECT COUNT(*) as c FROM users WHERE id = ?", args: [targetId] }),
      db.execute({ sql: "SELECT COUNT(*) as c FROM shifts WHERE user_id = ?", args: [targetId] }),
      db.execute({ sql: "SELECT COUNT(*) as c FROM day_expenses WHERE user_id = ?", args: [targetId] }),
      db.execute({ sql: "SELECT COUNT(*) as c FROM week_extras WHERE user_id = ?", args: [targetId] }),
      db.execute({ sql: "SELECT COUNT(*) as c FROM user_sessions WHERE user_id = ?", args: [targetId] }),
    ]);
    expect(Number(users.rows[0].c)).toBe(0);
    expect(Number(shifts.rows[0].c)).toBe(0);
    expect(Number(dayExpenses.rows[0].c)).toBe(0);
    expect(Number(weekExtras.rows[0].c)).toBe(0);
    expect(Number(sessions.rows[0].c)).toBe(0);
  });

  it("returns 404 deleting a user that doesn't exist", async () => {
    const res = await request(app).delete("/api/admin/users/not-a-real-id").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
