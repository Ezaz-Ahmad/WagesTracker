import type { Client } from "@libsql/client";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { earningsForRange } from "../src/earnings.js";
import { addIsoDays, startOfWeekISO, type WeekStart } from "../src/weekBoundary.js";
import { cleanupTestDb, createTestApp } from "./testApp.js";

const boundaryCases = [
  ["Monday", "2026-08-17", "2026-08-23"],
  ["Tuesday", "2026-08-18", "2026-08-24"],
  ["Wednesday", "2026-08-19", "2026-08-25"],
  ["Thursday", "2026-08-13", "2026-08-19"],
  ["Friday", "2026-08-14", "2026-08-20"],
  ["Saturday", "2026-08-15", "2026-08-21"],
  ["Sunday", "2026-08-16", "2026-08-22"],
] as const;

describe("admin persisted weekly earnings", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let userId: string;
  let regularToken: string;
  let adminToken: string;
  const otherId = "earnings-other-user";

  async function seedUser(id: string, weekStartsOn: WeekStart, rate = 20): Promise<void> {
    await db.execute({
      sql: `INSERT INTO users (id, name, email, password_hash, week_starts_on, rate, created_at)
            VALUES (?, ?, ?, 'private-test-hash', ?, ?, ?)`,
      args: [id, id, `${id}@example.com`, weekStartsOn, rate, "2026-06-01T00:00:00Z"],
    });
  }
  async function shift(id: string, date: string, signIn: string | null, signOut: string | null): Promise<void> {
    await db.execute({
      sql: `INSERT INTO shifts (id, user_id, date, sign_in, sign_out, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), id, date, signIn, signOut, date, date],
    });
  }
  async function fuel(id: string, date: string, amount: number): Promise<void> {
    await db.execute({
      sql: `INSERT INTO day_expenses (id, user_id, date, fuel_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), id, date, amount, date, date],
    });
  }
  async function extra(id: string, weekStart: string, amount: number): Promise<void> {
    await db.execute({
      sql: `INSERT INTO week_extras (id, user_id, week_start, effective_date, amount, reason, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'Bonus', ?, ?)`,
      args: [randomUUID(), id, weekStart, addIsoDays(weekStart, 6), amount, weekStart, weekStart],
    });
  }
  function earnings(id = userId, date = "2026-08-19") {
    return request(app).get(`/api/admin/users/${id}/earnings`).query({ date }).set("Authorization", `Bearer ${adminToken}`);
  }

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
    const signup = await request(app).post("/api/auth/signup").send({
      name: "Earnings User", email: "earnings-user@example.com", password: "admin-earnings-test-2026", rate: 27.31,
    });
    expect(signup.status).toBe(201);
    userId = signup.body.user.id;
    regularToken = signup.body.token;
    const login = await request(app).post("/api/admin/login").send({ password: process.env.ADMIN_PASSWORD });
    adminToken = login.body.token;
    await seedUser(otherId, "Sunday", 42);

    await shift(userId, "2026-08-17", "09:00:00", "10:00:01");
    await shift(userId, "2026-08-18", "22:00", "02:00");
    await shift(userId, "2026-08-18", "08:00:00", "08:00:01");
    await shift(userId, "2026-08-19", "10:00", null);
    await shift(userId, "2026-08-20", null, null);
    await fuel(userId, "2026-08-17", 12.34);
    await fuel(userId, "2026-08-21", 1.23);
    await extra(userId, "2026-08-17", 19.87);
    await shift(userId, "2026-08-10", "09:00", "11:00");
    await fuel(userId, "2026-08-10", 5);
    await extra(userId, "2026-08-10", 7.50);
    await shift(userId, "2026-07-20", "09:00", "10:00");
    await fuel(userId, "2026-07-06", 4.75);
    await extra(userId, "2026-06-29", 9.99);

    await shift(otherId, "2026-08-17", "09:00", "10:00");
    await shift(otherId, "2026-08-03", "09:00", "10:00");
    await fuel(otherId, "2026-08-17", 50);
    await extra(otherId, "2026-08-16", 75);
    for (const [day, start, end] of boundaryCases) {
      const id = `boundary-${day}`;
      await seedUser(id, day);
      await shift(id, start, "09:00", "10:00");
      await shift(id, end, "09:00", "11:00");
      await shift(id, addIsoDays(start, -1), "09:00", "12:00");
      await shift(id, addIsoDays(end, 1), "09:00", "13:00");
    }
    await seedUser("earnings-empty-user", "Friday");
  });

  afterAll(() => {
    db?.close();
    cleanupTestDb(dbPath);
  });

  it("requires an admin token for both directory totals and earnings history", async () => {
    for (const path of ["/api/admin/users?date=2026-08-19", `/api/admin/users/${userId}/earnings?date=2026-08-19`]) {
      expect((await request(app).get(path)).status).toBe(401);
      expect((await request(app).get(path).set("Authorization", `Bearer ${regularToken}`)).status).toBe(403);
      expect((await request(app).get(path).set("Authorization", "Bearer invalid")).status).toBe(401);
    }
  });

  it("matches canonical totals for saved second-precision and overnight shifts, fuel, extras and prior weeks", async () => {
    const response = await earnings();
    expect(response.status).toBe(200);
    const { week, previousWeek } = response.body;
    const expected = await earningsForRange(db, userId, "2026-08-17", "2026-08-23");
    expect(week).toMatchObject({
      weekStart: "2026-08-17", weekEnd: "2026-08-23", hours: 5.000556,
      fuel: 13.57, extras: 19.87, shiftCount: 5, completedShiftCount: 3, openShiftCount: 2,
    });
    expect(Math.round(week.total * 100)).toBe(expected.earningsCents);
    expect(week.hours).toBe(expected.hours);
    expect(Math.round((week.wages + week.fuel + week.extras) * 100)).toBe(expected.earningsCents);
    expect(week.days).toHaveLength(7);
    for (const day of week.days) {
      const expectedDay = await earningsForRange(db, userId, day.date, day.date);
      // Weekly extras have no invented allocation to a chart day.
      expect(Math.round(day.total * 100)).toBe(expectedDay.earningsCents - expectedDay.extrasCents);
      expect(day.extras).toBeUndefined();
    }
    expect(week.days[1]).toMatchObject({ hours: 4.000278, shiftCount: 2, openShiftCount: 0 });
    expect(week.days[2]).toMatchObject({ hours: 0, wages: 0, total: 0, shiftCount: 1, openShiftCount: 1 });
    expect(week.days[4]).toMatchObject({ hours: 0, fuel: 1.23, total: 1.23, shiftCount: 0 });
    expect(previousWeek).toMatchObject({
      weekStart: "2026-08-10", weekEnd: "2026-08-16", hours: 2, fuel: 5, extras: 7.50,
      total: 67.12, shiftCount: 1, completedShiftCount: 1, openShiftCount: 0,
    });
    expect(response.body.user).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it.each(boundaryCases)("honours %s weeks with seven ordered days and exact inclusive boundaries", async (day, start, end) => {
    const response = await earnings(`boundary-${day}`);
    expect(response.status).toBe(200);
    expect(response.body.week).toMatchObject({ weekStart: start, weekEnd: end, hours: 3, total: 60, shiftCount: 2 });
    expect(response.body.previousWeek).toMatchObject({ hours: 3, total: 60, shiftCount: 1 });
    expect(response.body.week.days.map((item: { date: string }) => item.date)).toEqual(
      Array.from({ length: 7 }, (_, index) => addIsoDays(start, index))
    );
  });

  it("returns each user's own totals in four fixed directory queries without exposing credentials", async () => {
    const spy = vi.spyOn(db, "execute");
    let response;
    try {
      response = await request(app).get("/api/admin/users?date=2026-08-19").set("Authorization", `Bearer ${adminToken}`);
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
    expect(response.status).toBe(200);
    const target = response.body.users.find((user: { id: string }) => user.id === userId);
    const other = response.body.users.find((user: { id: string }) => user.id === otherId);
    expect(target).toMatchObject({ shiftCount: 7, earnings: { hours: 5.000556, fuel: 13.57, extras: 19.87 } });
    expect(other).toMatchObject({ earnings: { weekStart: "2026-08-16", hours: 1, wages: 42, fuel: 50, extras: 75, total: 167 } });
    for (const user of response.body.users) {
      expect(user.password).toBeUndefined();
      expect(user.password_hash).toBeUndefined();
      expect(user.earnings.days).toHaveLength(7);
      expect(user.previousEarnings.days).toHaveLength(7);
    }
  });

  it("offers descending historical weeks from shifts, fuel-only and extras-only records scoped to this user", async () => {
    const response = await earnings();
    const weeks = response.body.availableWeeks;
    expect(weeks).toEqual([...new Set(weeks)].sort().reverse());
    expect(weeks).toEqual(expect.arrayContaining(["2026-08-17", "2026-08-10", "2026-07-20", "2026-07-06", "2026-06-29"]));
    expect(weeks).not.toContain("2026-08-03");
    expect(weeks).toContain(startOfWeekISO(new Date().toISOString().slice(0, 10), "Monday"));
    expect((await earnings(userId, "2026-07-06")).body.week).toMatchObject({ hours: 0, fuel: 4.75, extras: 0, total: 4.75 });
    expect((await earnings(userId, "2026-06-29")).body.week).toMatchObject({ hours: 0, fuel: 0, extras: 9.99, total: 9.99 });
  });

  it("returns zeroed seven-day series for empty weeks and supports the default current date", async () => {
    const response = await earnings("earnings-empty-user");
    expect(response.status).toBe(200);
    for (const week of [response.body.week, response.body.previousWeek]) {
      expect(week).toMatchObject({ hours: 0, wages: 0, fuel: 0, extras: 0, total: 0, shiftCount: 0, openShiftCount: 0 });
      expect(week.days).toHaveLength(7);
      expect(week.days.every((day: { total: number }) => day.total === 0)).toBe(true);
    }
    const current = await request(app).get(`/api/admin/users/${userId}/earnings`).set("Authorization", `Bearer ${adminToken}`);
    expect(current.status).toBe(200);
    expect(current.body.week.weekStart).toBe(startOfWeekISO(new Date().toISOString().slice(0, 10), "Monday"));
  });

  it.each(["2026-02-30", "2026-13-01", "2026-2-03", "not-a-date", "", "2026-08-19T00:00:00Z"])(
    "rejects invalid anchor %j with a useful calendar-date error", async (date) => {
      for (const path of ["/api/admin/users", `/api/admin/users/${userId}/earnings`]) {
        const response = await request(app).get(path).query({ date }).set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/real calendar date.*YYYY-MM-DD/);
      }
    }
  );

  it("rejects repeated date parameters and returns 404 for an unknown user", async () => {
    const repeated = await request(app).get(`/api/admin/users/${userId}/earnings?date=2026-08-19&date=2026-08-20`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(repeated.status).toBe(400);
    expect((await earnings("nonexistent-user")).status).toBe(404);
  });
});
