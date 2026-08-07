import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("day-expenses (fuel cost)", () => {
  let app: Express;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;
  const DATE = "2026-01-05";

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
    const a = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Fuel User A", email: "fuel-a@example.com", password: "password-a", rate: 20 });
    tokenA = a.body.token;
    const b = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Fuel User B", email: "fuel-b@example.com", password: "password-b", rate: 25 });
    tokenB = b.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("creates a fuel-cost record for a date", async () => {
    const res = await request(app)
      .put(`/api/day-expenses/${DATE}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ fuelCost: 12.5 });
    expect(res.status).toBe(200);
    expect(res.body.expense).toEqual({ date: DATE, fuelCost: 12.5 });
  });

  it("updates the existing record on a second save for the same date, without duplicating it", async () => {
    const res = await request(app)
      .put(`/api/day-expenses/${DATE}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ fuelCost: 20 });
    expect(res.status).toBe(200);
    expect(res.body.expense.fuelCost).toBe(20);

    const list = await request(app).get("/api/day-expenses").set("Authorization", `Bearer ${tokenA}`);
    const forDate = list.body.expenses.filter((e: { date: string }) => e.date === DATE);
    expect(forDate).toHaveLength(1);
    expect(forDate[0].fuelCost).toBe(20);
  });

  it("rejects a negative fuel cost", async () => {
    const res = await request(app)
      .put(`/api/day-expenses/${DATE}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ fuelCost: -5 });
    expect(res.status).toBe(400);
  });

  it("removes the record when saved as 0", async () => {
    const res = await request(app)
      .put(`/api/day-expenses/${DATE}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ fuelCost: 0 });
    expect(res.status).toBe(200);
    expect(res.body.expense).toBeNull();

    const list = await request(app).get("/api/day-expenses").set("Authorization", `Bearer ${tokenA}`);
    expect(list.body.expenses.filter((e: { date: string }) => e.date === DATE)).toHaveLength(0);
  });

  it("keeps fuel-cost records fully scoped per user", async () => {
    // A's turn: leave a real record behind again for the isolation checks below.
    await request(app).put(`/api/day-expenses/${DATE}`).set("Authorization", `Bearer ${tokenA}`).send({ fuelCost: 30 });

    // B has never touched this date — their list shouldn't include A's record.
    const bList = await request(app).get("/api/day-expenses").set("Authorization", `Bearer ${tokenB}`);
    expect(bList.body.expenses).toEqual([]);

    // B saving a fuel cost for the *same date* creates/updates only their own
    // row (the table's unique constraint is on (user_id, date), not date
    // alone) — it must never touch A's.
    await request(app).put(`/api/day-expenses/${DATE}`).set("Authorization", `Bearer ${tokenB}`).send({ fuelCost: 99 });

    const aList = await request(app).get("/api/day-expenses").set("Authorization", `Bearer ${tokenA}`);
    expect(aList.body.expenses).toEqual([{ date: DATE, fuelCost: 30 }]);

    const bList2 = await request(app).get("/api/day-expenses").set("Authorization", `Bearer ${tokenB}`);
    expect(bList2.body.expenses).toEqual([{ date: DATE, fuelCost: 99 }]);
  });
});
