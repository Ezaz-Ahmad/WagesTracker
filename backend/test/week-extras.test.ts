import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("week-extras (other earnings)", () => {
  let app: Express;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;
  const WEEK_START = "2026-01-05"; // a Monday

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
    const a = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Extra User A", email: "extra-a@example.com", password: "extras-user-a-secure-2026", rate: 20 });
    tokenA = a.body.token;
    const b = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Extra User B", email: "extra-b@example.com", password: "extras-user-b-secure-2026", rate: 25 });
    tokenB = b.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("creates a weekly extra-earnings entry", async () => {
    const res = await request(app)
      .put(`/api/week-extras/${WEEK_START}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ amount: 40, reason: "Holiday tip" });
    expect(res.status).toBe(200);
    expect(res.body.extra).toEqual({ weekStart: WEEK_START, amount: 40, reason: "Holiday tip" });
  });

  it("updates the existing entry on a second save for the same week, without duplicating it", async () => {
    const res = await request(app)
      .put(`/api/week-extras/${WEEK_START}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ amount: 55, reason: "Revised bonus" });
    expect(res.status).toBe(200);
    expect(res.body.extra.amount).toBe(55);
    expect(res.body.extra.reason).toBe("Revised bonus");

    const list = await request(app).get("/api/week-extras").set("Authorization", `Bearer ${tokenA}`);
    const forWeek = list.body.extras.filter((e: { weekStart: string }) => e.weekStart === WEEK_START);
    expect(forWeek).toHaveLength(1);
    expect(forWeek[0].amount).toBe(55);
  });

  it("rejects extra earnings with no reason given", async () => {
    const res = await request(app)
      .put(`/api/week-extras/${WEEK_START}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ amount: 40 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative amount", async () => {
    const res = await request(app)
      .put(`/api/week-extras/${WEEK_START}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ amount: -10, reason: "Should not save" });
    expect(res.status).toBe(400);
  });

  it("keeps week-extras records fully scoped per user", async () => {
    await request(app)
      .put(`/api/week-extras/${WEEK_START}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ amount: 55, reason: "Revised bonus" });

    // B has never touched this week — their list shouldn't include A's entry.
    const bList = await request(app).get("/api/week-extras").set("Authorization", `Bearer ${tokenB}`);
    expect(bList.body.extras).toEqual([]);

    // B saving an entry for the *same week* creates/updates only their own
    // row (unique on (user_id, week_start), not week_start alone) — must
    // never touch A's.
    await request(app)
      .put(`/api/week-extras/${WEEK_START}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ amount: 99, reason: "B's own bonus" });

    const aList = await request(app).get("/api/week-extras").set("Authorization", `Bearer ${tokenA}`);
    expect(aList.body.extras).toEqual([{ weekStart: WEEK_START, amount: 55, reason: "Revised bonus" }]);

    const bList2 = await request(app).get("/api/week-extras").set("Authorization", `Bearer ${tokenB}`);
    expect(bList2.body.extras).toEqual([{ weekStart: WEEK_START, amount: 99, reason: "B's own bonus" }]);
  });

  it("accepts only a real date aligned with the user's current boundary", async () => {
    const changed = await request(app)
      .patch("/api/me")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ weekStartsOn: "Tuesday" });
    expect(changed.status).toBe(200);

    const wrongWeekday = await request(app)
      .put("/api/week-extras/2026-01-19")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ amount: 10, reason: "Wrong weekday" });
    expect(wrongWeekday.status).toBe(400);
    expect(wrongWeekday.body.error).toContain("Tuesday");

    const impossibleDate = await request(app)
      .put("/api/week-extras/2026-02-30")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ amount: 10, reason: "Impossible date" });
    expect(impossibleDate.status).toBe(400);
    expect(impossibleDate.body.error).toContain("real calendar date");

    const valid = await request(app)
      .put("/api/week-extras/2026-01-20")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ amount: 10, reason: "Tuesday bonus" });
    expect(valid.status).toBe(200);
  });
});
