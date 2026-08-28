import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import type { Express } from "express";
import { cleanupTestDb, createTestApp } from "./testApp.js";

const PASSWORD = "correct horse battery staple";

describe("structured work locations and automatic fuel allowance", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
    const a = await request(app).post("/api/auth/signup").send({
      name: "Location Owner A",
      email: "locations-a@example.com",
      password: PASSWORD,
      rate: 30,
    });
    const b = await request(app).post("/api/auth/signup").send({
      name: "Location Owner B",
      email: "locations-b@example.com",
      password: PASSWORD,
      rate: 30,
    });
    tokenA = a.body.token;
    tokenB = b.body.token;
  });

  afterAll(async () => {
    db.close();
    cleanupTestDb(dbPath);
  });

  async function createLocation(name: string, fuelAllowance: number | null, token = tokenA) {
    return request(app)
      .post("/api/work-locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name, address: `${name} address`, fuelAllowance });
  }

  async function createShift(date: string, workLocationId: string, signIn: string, signOut: string) {
    return request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date, workLocationId, signIn, signOut });
  }

  it("creates user-owned locations, rejects duplicate normalized names, and isolates users", async () => {
    const created = await createLocation("  Downtown   Store  ", 15.25);
    expect(created.status).toBe(201);
    expect(created.body.location).toMatchObject({
      name: "Downtown Store",
      address: "Downtown   Store   address",
      fuelAllowance: 15.25,
      archived: false,
    });

    const duplicate = await createLocation("downtown store", 12);
    expect(duplicate.status).toBe(409);

    const otherUserList = await request(app)
      .get("/api/work-locations?includeArchived=true")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(otherUserList.body.locations).toEqual([]);

    const otherUserEdit = await request(app)
      .patch(`/api/work-locations/${created.body.location.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Stolen" });
    expect(otherUserEdit.status).toBe(404);
  });

  it("validates positive two-decimal fuel amounts", async () => {
    expect((await createLocation("Zero", 0)).status).toBe(400);
    expect((await createLocation("Too precise", 1.234)).status).toBe(400);
    expect((await createLocation("Too large", 10_000.01)).status).toBe(400);
  });

  it("adds each worked branch once per date and sums different branches", async () => {
    const first = await createLocation("North Branch", 12.5);
    const second = await createLocation("South Branch", 7.25);
    const date = "2026-08-10";

    expect((await createShift(date, first.body.location.id, "08:00", "10:00")).status).toBe(201);
    expect((await createShift(date, first.body.location.id, "10:30", "12:00")).status).toBe(201);
    expect((await createShift(date, second.body.location.id, "13:00", "17:00")).status).toBe(201);

    const expenses = await request(app)
      .get(`/api/day-expenses?from=${date}&to=${date}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(expenses.body.expenses).toEqual([{
      date,
      fuelCost: 19.75,
      automaticFuelAllowance: 19.75,
      manualOverride: null,
      source: "automatic",
    }]);
  });

  it("supports a dated manual override and restores the automatic amount", async () => {
    const date = "2026-08-10";
    const overridden = await request(app)
      .put(`/api/day-expenses/${date}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ fuelCost: 30 });
    expect(overridden.body.expense).toMatchObject({
      fuelCost: 30,
      automaticFuelAllowance: 19.75,
      manualOverride: 30,
      source: "manual",
    });

    const restored = await request(app)
      .put(`/api/day-expenses/${date}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ fuelCost: null });
    expect(restored.body.expense).toMatchObject({
      fuelCost: 19.75,
      automaticFuelAllowance: 19.75,
      manualOverride: null,
      source: "automatic",
    });
  });

  it("snapshots names and allowances so later edits and archives do not rewrite history", async () => {
    const location = await createLocation("Snapshot Branch", 9);
    const id = location.body.location.id;
    const firstDate = "2026-08-11";
    const secondDate = "2026-08-12";
    const firstShift = await createShift(firstDate, id, "09:00", "12:00");

    await request(app)
      .patch(`/api/work-locations/${id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Renamed Branch", fuelAllowance: 14 });
    await createShift(secondDate, id, "09:00", "12:00");
    await request(app)
      .delete(`/api/work-locations/${id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    const shifts = await request(app)
      .get(`/api/shifts?from=${firstDate}&to=${secondDate}`)
      .set("Authorization", `Bearer ${tokenA}`);
    const historical = shifts.body.shifts.find((shift: { id: string }) => shift.id === firstShift.body.shift.id);
    expect(historical).toMatchObject({ location: "Snapshot Branch", fuelAllowanceSnapshot: 9 });
    expect(shifts.body.shifts).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: secondDate, location: "Renamed Branch", fuelAllowanceSnapshot: 14 }),
    ]));

    const expenses = await request(app)
      .get(`/api/day-expenses?from=${firstDate}&to=${secondDate}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(expenses.body.expenses.map((expense: { fuelCost: number }) => expense.fuelCost)).toEqual([9, 14]);
  });

  it("returns previous-week branch order as a read-only current-week suggestion", async () => {
    const location = await createLocation("Remembered Branch", 5);
    await createShift("2026-08-13", location.body.location.id, "08:00", "09:00");

    const suggestions = await request(app)
      .get("/api/work-locations/suggestions?weekStart=2026-08-17")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.suggestions["2026-08-20"]).toContain(location.body.location.id);

    const phantom = await db.execute({
      sql: "SELECT COUNT(*) AS count FROM shifts WHERE user_id = (SELECT id FROM users WHERE email = ?) AND date = ?",
      args: ["locations-a@example.com", "2026-08-20"],
    });
    expect(Number(phantom.rows[0].count)).toBe(0);
  });
});
