import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("active-shift clock-out contract", () => {
  let app: Express;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
    const a = await request(app).post("/api/auth/signup").send({
      name: "Clock User A",
      email: "clock-a@example.com",
      password: "clock-user-a-secure-2026",
      rate: 30,
    });
    const b = await request(app).post("/api/auth/signup").send({
      name: "Clock User B",
      email: "clock-b@example.com",
      password: "clock-user-b-secure-2026",
      rate: 35,
    });
    tokenA = a.body.token;
    tokenB = b.body.token;
  });

  afterAll(() => cleanupTestDb(dbPath));

  async function start(token: string, date: string, signIn: string) {
    return request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${token}`)
      .send({ date, location: "Operations", signIn });
  }

  it("returns a narrow action token only for a newly-open shift", async () => {
    const open = await start(tokenA, "2026-08-20", "09:00:00");
    expect(open.status).toBe(201);
    expect(open.body.shift.signOut).toBeNull();
    expect(open.body.clockOutToken).toEqual(expect.any(String));

    const complete = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ signOut: "17:00:00" });
    expect(complete.status).toBe(200);

    const historical = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "2026-08-19", location: "Operations", signIn: "09:00", signOut: "17:00" });
    expect(historical.status).toBe(201);
    expect(historical.body.clockOutToken).toBeUndefined();
  });

  it("clocks out from the native action without a full user session token", async () => {
    const open = await start(tokenA, "2026-08-21", "09:00:00");
    const result = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-action`)
      .set("X-Shift-Clock-Out-Token", open.body.clockOutToken)
      .send({ signOut: "17:27:30" });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      alreadyEnded: false,
      finalDurationSeconds: 30_450,
      shift: { id: open.body.shift.id, signOut: "17:27:30" },
    });
  });

  it("is idempotent: a replay cannot replace the first finishing time", async () => {
    const open = await start(tokenA, "2026-08-22", "08:15:00");
    const first = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-action`)
      .set("X-Shift-Clock-Out-Token", open.body.clockOutToken)
      .send({ signOut: "16:45:00" });
    const replay = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-action`)
      .set("X-Shift-Clock-Out-Token", open.body.clockOutToken)
      .send({ signOut: "19:59:59" });

    expect(first.body.shift.signOut).toBe("16:45:00");
    expect(replay.status).toBe(200);
    expect(replay.body.alreadyEnded).toBe(true);
    expect(replay.body.shift.signOut).toBe("16:45:00");
    expect(replay.body.finalDurationSeconds).toBe(30_600);
  });

  it("rejects missing, invalid, or wrong-shift action credentials", async () => {
    const openA = await start(tokenA, "2026-08-23", "07:00:00");
    const openB = await start(tokenB, "2026-08-23", "07:30:00");

    const missing = await request(app)
      .post(`/api/shifts/${openA.body.shift.id}/clock-out-action`)
      .send({ signOut: "08:00:00" });
    const wrongShift = await request(app)
      .post(`/api/shifts/${openB.body.shift.id}/clock-out-action`)
      .set("X-Shift-Clock-Out-Token", openA.body.clockOutToken)
      .send({ signOut: "08:00:00" });

    expect(missing.status).toBe(401);
    expect(wrongShift.status).toBe(401);

    await request(app)
      .post(`/api/shifts/${openA.body.shift.id}/clock-out`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ signOut: "08:00:00" });
    await request(app)
      .post(`/api/shifts/${openB.body.shift.id}/clock-out`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ signOut: "08:00:00" });
  });

  it("reissues a scoped token after relaunch only to the owner of an open shift", async () => {
    const open = await start(tokenA, "2026-08-24", "10:00:00");
    const owner = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-token`)
      .set("Authorization", `Bearer ${tokenA}`);
    const otherUser = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-token`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(owner.status).toBe(200);
    expect(owner.body.clockOutToken).toEqual(expect.any(String));
    expect(otherUser.status).toBe(404);

    await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-action`)
      .set("X-Shift-Clock-Out-Token", owner.body.clockOutToken)
      .send({ signOut: "18:00:00" });
    const after = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-token`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(after.status).toBe(404);
  });

  it("keeps an active shift untouched when clock-out validation fails", async () => {
    const open = await start(tokenA, "2026-08-25", "11:00:00");
    const invalid = await request(app)
      .post(`/api/shifts/${open.body.shift.id}/clock-out-action`)
      .set("X-Shift-Clock-Out-Token", open.body.clockOutToken)
      .send({ signOut: "11:00:00" });
    expect(invalid.status).toBe(400);

    const shifts = await request(app)
      .get("/api/shifts?from=2026-08-25&to=2026-08-25")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(shifts.body.shifts[0].signOut).toBeNull();
  });
});
