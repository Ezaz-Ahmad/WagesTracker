import type { Client } from "@libsql/client";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";
import { WEEK_DAYS } from "../src/weekBoundary.js";

describe("me (profile/settings)", () => {
  let app: Express;
  let dbPath: string;
  let db: Client;
  let token: string;

  beforeAll(async () => {
    ({ app, dbPath, db } = await createTestApp());
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Settings User", email: "settings@example.com", password: "settings-user-secure-2026", rate: 20 });
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

  it("accepts every day of the week and rejects values outside the shared contract", async () => {
    for (const weekStartsOn of WEEK_DAYS) {
      const response = await request(app)
        .patch("/api/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ weekStartsOn });
      expect(response.status).toBe(200);
      expect(response.body.user.weekStartsOn).toBe(weekStartsOn);
    }

    const invalid = await request(app)
      .patch("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ weekStartsOn: "Funday" });
    expect(invalid.status).toBe(400);
  });

  it("reassociates extras without drift or deleting raw historical records", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({
        name: "Boundary Migration User",
        email: "boundary-migration@example.com",
        password: "boundary-migration-secure-2026",
        rate: 30,
      });
    const migrationToken = signup.body.token as string;
    const userId = signup.body.user.id as string;

    await request(app)
      .put("/api/week-extras/2026-01-05")
      .set("Authorization", `Bearer ${migrationToken}`)
      .send({ amount: 40, reason: "First bonus" });
    await request(app)
      .put("/api/week-extras/2026-01-12")
      .set("Authorization", `Bearer ${migrationToken}`)
      .send({ amount: 55, reason: "Second bonus" });

    const shiftId = randomUUID();
    const expenseId = randomUUID();
    const now = new Date().toISOString();
    await db.batch(
      [
        {
          sql: `INSERT INTO shifts (id, user_id, date, location, sign_in, sign_out, created_at, updated_at)
                VALUES (?, ?, '2026-01-07', 'Original location', '09:00', '17:00', ?, ?)`,
          args: [shiftId, userId, now, now],
        },
        {
          sql: `INSERT INTO day_expenses (id, user_id, date, fuel_cost, created_at, updated_at)
                VALUES (?, ?, '2026-01-08', 12.5, ?, ?)`,
          args: [expenseId, userId, now, now],
        },
      ],
      "write"
    );

    const before = await db.execute({
      sql: "SELECT id, week_start, effective_date, amount, reason FROM week_extras WHERE user_id = ? ORDER BY week_start",
      args: [userId],
    });
    expect(before.rows.map((row) => ({
      id: String(row.id),
      weekStart: String(row.week_start),
      effectiveDate: String(row.effective_date),
      amount: Number(row.amount),
      reason: String(row.reason),
    }))).toEqual([
      { id: expect.any(String), weekStart: "2026-01-05", effectiveDate: "2026-01-11", amount: 40, reason: "First bonus" },
      { id: expect.any(String), weekStart: "2026-01-12", effectiveDate: "2026-01-18", amount: 55, reason: "Second bonus" },
    ]);
    const originalIds = before.rows.map((row) => String(row.id));

    const thursday = await request(app)
      .patch("/api/me")
      .set("Authorization", `Bearer ${migrationToken}`)
      .send({ weekStartsOn: "Thursday" });
    expect(thursday.status).toBe(200);
    expect(thursday.body.extras).toEqual([
      { weekStart: "2026-01-08", amount: 40, reason: "First bonus" },
      { weekStart: "2026-01-15", amount: 55, reason: "Second bonus" },
    ]);

    let list = await request(app).get("/api/week-extras").set("Authorization", `Bearer ${migrationToken}`);
    expect(list.body.extras).toEqual([
      { weekStart: "2026-01-08", amount: 40, reason: "First bonus" },
      { weekStart: "2026-01-15", amount: 55, reason: "Second bonus" },
    ]);

    // A second preference change must use the original stable attribution
    // dates, not week_start + 6 again, or both rows would drift by a day.
    const tuesday = await request(app)
      .patch("/api/me")
      .set("Authorization", `Bearer ${migrationToken}`)
      .send({ weekStartsOn: "Tuesday" });
    expect(tuesday.status).toBe(200);
    list = await request(app).get("/api/week-extras").set("Authorization", `Bearer ${migrationToken}`);
    expect(list.body.extras).toEqual([
      { weekStart: "2026-01-06", amount: 40, reason: "First bonus" },
      { weekStart: "2026-01-13", amount: 55, reason: "Second bonus" },
    ]);

    const backendEarnings = await request(app)
      .get("/api/spending/summary?from=2026-01-06&to=2026-01-12")
      .set("Authorization", `Bearer ${migrationToken}`)
      .set("X-Client-Time-Zone", "Australia/Sydney");
    expect(backendEarnings.status).toBe(200);
    // 8h × $30 + $12.50 fuel + the one extra re-keyed to Tue Jan 6.
    expect(backendEarnings.body.earningsCents).toBe(29250);

    const afterExtras = await db.execute({
      sql: "SELECT id, effective_date, amount, reason FROM week_extras WHERE user_id = ? ORDER BY effective_date",
      args: [userId],
    });
    expect(afterExtras.rows.map((row) => String(row.id))).toEqual(originalIds);
    expect(afterExtras.rows.map((row) => String(row.effective_date))).toEqual(["2026-01-11", "2026-01-18"]);
    expect(afterExtras.rows.map((row) => Number(row.amount))).toEqual([40, 55]);
    expect(afterExtras.rows.map((row) => String(row.reason))).toEqual(["First bonus", "Second bonus"]);

    const [shiftAfter, expenseAfter] = await Promise.all([
      db.execute({ sql: "SELECT * FROM shifts WHERE id = ?", args: [shiftId] }),
      db.execute({ sql: "SELECT * FROM day_expenses WHERE id = ?", args: [expenseId] }),
    ]);
    expect(shiftAfter.rows).toHaveLength(1);
    expect(String(shiftAfter.rows[0].date)).toBe("2026-01-07");
    expect(String(shiftAfter.rows[0].location)).toBe("Original location");
    expect(expenseAfter.rows).toHaveLength(1);
    expect(String(expenseAfter.rows[0].date)).toBe("2026-01-08");
    expect(Number(expenseAfter.rows[0].fuel_cost)).toBe(12.5);
  });
});
