import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import type { Express } from "express";
import { createTestApp, cleanupTestDb } from "./testApp.js";

describe("jobs and recorded location pay", () => {
  let app: Express,
    db: Client,
    dbPath: string,
    token: string,
    otherToken: string,
    ownerId: string,
    primary: string,
    second: string,
    firstLocation: string,
    secondLocation: string,
    shiftId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
    const signup = await request(app).post("/api/auth/signup").send({
      name: "Multiple jobs",
      email: "jobs@example.com",
      password: "correct horse battery staple",
      rate: 30,
      workLocationName: "Original workplace",
    });
    token = signup.body.token;
    ownerId = signup.body.user.id;
    const other = await request(app).post("/api/auth/signup").send({
      name: "Other owner",
      email: "other-jobs@example.com",
      password: "correct horse battery staple",
      rate: 25,
    });
    otherToken = other.body.token;
  });
  afterAll(() => {
    db.close();
    cleanupTestDb(dbPath);
  });
  it("creates a primary job without discarding the account's locations or settings", async () => {
    const r = await request(app).get("/api/jobs").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.jobs).toHaveLength(1);
    primary = r.body.jobs[0].id;
    expect(r.body.jobs[0]).toMatchObject({
      name: "Original workplace",
      rate: 30,
      isPrimary: true,
    });
    const locations = await request(app).get("/api/work-locations").set(auth());
    expect(locations.body.locations[0]).toMatchObject({
      jobId: primary,
      name: "Original workplace",
      hourlyRate: 30,
    });
  });
  it("supports the same location name at different jobs and isolates ownership", async () => {
    const j = await request(app)
      .post("/api/jobs")
      .set(auth())
      .send({ name: "Second employer", rate: 40, weekStartsOn: "Wednesday" });
    expect(j.status).toBe(201);
    second = j.body.job.id;
    for (const [job, key] of [
      [primary, "first"],
      [second, "second"],
    ]) {
      const l = await request(app)
        .post("/api/work-locations")
        .set(auth())
        .set("X-Work-Job", job)
        .send({ name: "Newcastle", fuelAllowance: key === "first" ? 10 : 15 });
      expect(l.status).toBe(201);
      if (key === "first") firstLocation = l.body.location.id;
      else secondLocation = l.body.location.id;
    }
    expect(
      (
        await request(app)
          .get("/api/work-locations")
          .set("Authorization", `Bearer ${otherToken}`)
          .set("X-Work-Job", second)
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/jobs/${second}/rates`)
          .set("Authorization", `Bearer ${otherToken}`)
          .send({
            locationId: secondLocation,
            rate: 99,
            effectiveFrom: "2026-08-01",
          })
      ).status
    ).toBe(404);
  });
  it("uses the worked-date rate and freezes completed earnings across later pay changes", async () => {
    expect(
      (
        await request(app).post(`/api/jobs/${primary}/rates`).set(auth()).send({
          locationId: firstLocation,
          rate: 34,
          effectiveFrom: "2026-08-15",
        })
      ).status
    ).toBe(201);
    const r = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", primary)
      .send({
        date: "2026-08-17",
        workLocationId: firstLocation,
        signIn: "09:00",
        signOut: "15:00",
      });
    expect(r.status).toBe(201);
    shiftId = r.body.shift.id;
    expect(r.body.shift).toMatchObject({
      jobId: primary,
      appliedRate: 34,
      rateSource: "location",
    });
    expect(
      (
        await request(app).post(`/api/jobs/${primary}/rates`).set(auth()).send({
          locationId: firstLocation,
          rate: 36,
          effectiveFrom: "2026-08-18",
        })
      ).status
    ).toBe(201);
    const old = await request(app)
      .get("/api/shifts?from=2026-08-17&to=2026-08-17")
      .set(auth())
      .set("X-Work-Job", primary);
    expect(old.body.shifts[0].appliedRate).toBe(34);
    const backdated = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", primary)
      .send({
        date: "2026-08-14",
        workLocationId: firstLocation,
        signIn: "09:00",
        signOut: "15:00",
      });
    expect(backdated.body.shift.appliedRate).toBe(30);
  });
  it("scopes fuel and extras by job and rejects a location from another job", async () => {
    const wrong = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", second)
      .send({
        date: "2026-08-17",
        workLocationId: firstLocation,
        signIn: "17:00",
        signOut: "19:00",
      });
    expect(wrong.status).toBe(400);
    const r = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", second)
      .send({
        date: "2026-08-17",
        workLocationId: secondLocation,
        signIn: "17:00",
        signOut: "19:00",
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.shift.appliedRate).toBe(40);
    for (const [job, fuel] of [
      [primary, 10],
      [second, 15],
    ] as const) {
      const r = await request(app)
        .get("/api/day-expenses?from=2026-08-17&to=2026-08-17")
        .set(auth())
        .set("X-Work-Job", job);
      expect(r.body.expenses).toHaveLength(1);
      expect(r.body.expenses[0]).toMatchObject({ jobId: job, fuelCost: fuel });
    }
    const all = await request(app)
      .get("/api/day-expenses?from=2026-08-17&to=2026-08-17")
      .set(auth())
      .set("X-Work-Job", "all");
    expect(all.body.expenses).toHaveLength(2);
    for (const [job, date] of [
      [primary, "2026-08-17"],
      [second, "2026-08-19"],
    ])
      expect(
        (
          await request(app)
            .put(`/api/week-extras/${date}`)
            .set(auth())
            .set("X-Work-Job", job)
            .send({ amount: 25, reason: "Own job bonus" })
        ).status
      ).toBe(200);
    expect(
      (
        await request(app)
          .patch(`/api/shifts/${shiftId}`)
          .set(auth())
          .set("X-Work-Job", second)
          .send({ signOut: "16:00" })
      ).status
    ).toBe(404);
  });
  it("retains cross-job overlap and single-running-shift protection", async () => {
    const overlap = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", second)
      .send({
        date: "2026-08-17",
        workLocationId: secondLocation,
        signIn: "10:00",
        signOut: "12:00",
      });
    expect(overlap.status).toBe(409);
    const a = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", primary)
      .send({
        date: "2026-08-20",
        workLocationId: firstLocation,
        signIn: "09:00",
        signOut: null,
      });
    expect(a.status).toBe(201);
    const b = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", second)
      .send({
        date: "2026-08-20",
        workLocationId: secondLocation,
        signIn: "10:00",
        signOut: null,
      });
    expect(b.status).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/jobs/${primary}`)
          .set(auth())
          .send({ archived: true })
      ).status
    ).toBe(409);
    const finish = await request(app)
      .post(`/api/shifts/${a.body.shift.id}/clock-out`)
      .set(auth())
      .set("X-Work-Job", "all")
      .set("X-Client-Time-Zone", "UTC")
      .send({ signOut: "12:00" });
    expect(finish.status).toBe(200);
    expect(finish.body.shift.appliedRate).toBe(36);
  });
  it("requires review before an explicit saved-rate correction", async () => {
    const before = await request(app)
      .patch(`/api/shifts/${shiftId}`)
      .set(auth())
      .set("X-Work-Job", primary)
      .send({ rateOverride: 35 });
    expect(before.status).toBe(409);
    expect(before.body.code).toBe("RATE_CHANGE_CONFIRMATION_REQUIRED");
    const after = await request(app)
      .patch(`/api/shifts/${shiftId}`)
      .set(auth())
      .set("X-Work-Job", primary)
      .send({ rateOverride: 35, confirmRateChange: true });
    expect(after.status).toBe(200);
    expect(after.body.shift).toMatchObject({
      appliedRate: 35,
      rateSource: "manual",
    });
  });
  it("can switch a location back to its job default without changing saved shifts", async () => {
    await request(app)
      .post(`/api/jobs/${primary}/rates`)
      .set(auth())
      .send({ locationId: null, rate: 31, effectiveFrom: "2026-08-21" });
    await request(app).post(`/api/jobs/${primary}/rates`).set(auth()).send({
      locationId: firstLocation,
      rate: null,
      effectiveFrom: "2026-08-21",
    });
    const shift = await request(app)
      .post("/api/shifts")
      .set(auth())
      .set("X-Work-Job", primary)
      .send({
        date: "2026-08-21",
        workLocationId: firstLocation,
        signIn: "09:00",
        signOut: "10:00",
      });
    expect(shift.body.shift).toMatchObject({
      appliedRate: 31,
      rateSource: "job",
    });
    expect(
      (
        await request(app)
          .post("/api/shifts")
          .set(auth())
          .set("X-Work-Job", "all")
          .send({ date: "2026-08-22", signIn: "09:00", signOut: "10:00" })
      ).status
    ).toBe(400);
  });
  it("keeps combined admin totals and per-job drilldowns consistent with recorded pay", async () => {
    const login = await request(app)
      .post("/api/admin/login")
      .send({ password: "test-admin-password" });
    const admin = { Authorization: `Bearer ${login.body.token}` };
    const combined = await request(app)
      .get(`/api/admin/users/${ownerId}/earnings?date=2026-08-19`)
      .set(admin);
    expect(combined.status).toBe(200);
    expect(combined.body.week).toMatchObject({
      weekStart: "2026-08-17",
      wages: 429,
      fuel: 45,
      extras: 25,
      total: 499,
    });
    expect(
      combined.body.jobs.reduce(
        (sum: number, j: { earnings: { total: number } }) =>
          sum + j.earnings.total,
        0
      )
    ).toBe(499);
    const scoped = await request(app)
      .get(
        `/api/admin/users/${ownerId}/earnings?date=2026-08-19&jobId=${second}`
      )
      .set(admin);
    expect(scoped.body.week).toMatchObject({
      weekStart: "2026-08-19",
      wages: 0,
      fuel: 0,
      extras: 25,
      total: 25,
    });
    const directory = await request(app)
      .get("/api/admin/users?date=2026-08-19")
      .set(admin);
    expect(
      directory.body.users.find((u: { id: string }) => u.id === ownerId)
    ).toMatchObject({
      jobCount: 2,
      activeJobCount: 2,
      rate: 31,
      earnings: { total: 499, weekStart: "2026-08-17" },
    });
    const wrong = await request(app)
      .get(
        `/api/admin/users/${ownerId}/earnings?date=2026-08-19&jobId=someone-else`
      )
      .set(admin);
    expect(wrong.status).toBe(404);
  });
  it("uses one spending ledger, preserves tags on edits and rejects another owner's job", async () => {
    const categories = await request(app)
      .get("/api/spending/categories")
      .set(auth());
    const input = {
      amountCents: 1500,
      categoryId: categories.body.categories[0].id,
      spentAt: "2026-08-17T12:00",
      jobId: second,
    };
    const created = await request(app)
      .post("/api/spending/expenses")
      .set(auth())
      .set("X-Client-Time-Zone", "Australia/Sydney")
      .send(input);
    expect(created.status).toBe(201);
    expect(created.body.expense.jobId).toBe(second);
    const updated = await request(app)
      .patch(`/api/spending/expenses/${created.body.expense.id}`)
      .set(auth())
      .set("X-Client-Time-Zone", "Australia/Sydney")
      .send({ note: "Dinner after work" });
    expect(updated.body.expense.jobId).toBe(second);
    const filtered = await request(app)
      .get(`/api/spending/expenses?linkedJobId=${second}`)
      .set(auth());
    expect(filtered.body.expenses).toHaveLength(1);
    const otherJobs = await request(app)
      .get("/api/jobs")
      .set("Authorization", `Bearer ${otherToken}`);
    const wrong = await request(app)
      .post("/api/spending/expenses")
      .set(auth())
      .set("X-Client-Time-Zone", "Australia/Sydney")
      .send({ ...input, jobId: otherJobs.body.jobs[0].id });
    expect(wrong.status).toBe(400);
    const untag = await request(app)
      .patch(`/api/spending/expenses/${created.body.expense.id}`)
      .set(auth())
      .set("X-Client-Time-Zone", "Australia/Sydney")
      .send({ jobId: null });
    expect(untag.body.expense.jobId).toBeNull();
  });
  it("reviews replacements for the same effective date and leaves previously saved pay intact", async () => {
    const body = { locationId: null, rate: 32, effectiveFrom: "2026-08-21" };
    expect(
      (
        await request(app)
          .post(`/api/jobs/${primary}/rates`)
          .set(auth())
          .send(body)
      ).status
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/api/jobs/${primary}/rates`)
          .set(auth())
          .send({ ...body, replaceExisting: true })
      ).status
    ).toBe(200);
    const saved = await request(app)
      .get("/api/shifts?from=2026-08-21&to=2026-08-21")
      .set(auth())
      .set("X-Work-Job", primary);
    expect(saved.body.shifts[0].appliedRate).toBe(31);
  });
  it("uses the job default when explicitly clearing a shift's custom-rate location", async () => {
    const clear = { workLocationId: null, location: "" };
    const review = await request(app)
      .patch(`/api/shifts/${shiftId}`)
      .set(auth())
      .set("X-Work-Job", primary)
      .send(clear);
    expect(review.body).toMatchObject({
      code: "RATE_CHANGE_CONFIRMATION_REQUIRED",
      previousRate: 35,
      proposedRate: 30,
    });
    const saved = await request(app)
      .patch(`/api/shifts/${shiftId}`)
      .set(auth())
      .set("X-Work-Job", primary)
      .send({ ...clear, confirmRateChange: true });
    expect(saved.body.shift).toMatchObject({
      appliedRate: 30,
      rateSource: "job",
      workLocationId: null,
    });
  });
  it("serializes overlapping entries across two jobs", async () => {
    const results = await Promise.all(
      [primary, second].map((job) =>
        request(app)
          .post("/api/shifts")
          .set(auth())
          .set("X-Work-Job", job)
          .send({ date: "2026-08-26", signIn: "09:00", signOut: "12:00" })
      )
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it("keeps job preferences when account details or the combined goal are updated", async () => {
    const preferences = {
      weekStartsOn: "Tuesday",
      goalHours: 22,
      goalEarnings: 850,
      smartRemindersEnabled: true,
    };
    expect(
      (
        await request(app)
          .patch(`/api/jobs/${primary}`)
          .set(auth())
          .send(preferences)
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .patch("/api/me")
          .set(auth())
          .send({ name: "Updated name", combinedGoalEarnings: 1400 })
      ).status
    ).toBe(200);
    const jobs = await request(app).get("/api/jobs").set(auth());
    expect(
      jobs.body.jobs.find((job: { id: string }) => job.id === primary)
    ).toMatchObject(preferences);
    expect(
      jobs.body.jobs.find((job: { id: string }) => job.id === second)
        .weekStartsOn
    ).toBe("Wednesday");
  });
  it("archives without deleting history, rejects writes and restores the workspace", async () => {
    expect(
      (
        await request(app)
          .patch(`/api/jobs/${second}`)
          .set(auth())
          .send({ archived: true })
      ).status
    ).toBe(200);
    const history = await request(app)
      .get("/api/shifts?from=2026-08-17&to=2026-08-17")
      .set(auth())
      .set("X-Work-Job", second);
    expect(history.body.shifts).toHaveLength(1);
    expect(
      (
        await request(app)
          .post("/api/shifts")
          .set(auth())
          .set("X-Work-Job", second)
          .send({ date: "2026-08-27", signIn: "09:00", signOut: "10:00" })
      ).status
    ).toBe(409);
    expect(
      (
        await request(app)
          .delete(`/api/work-locations/${secondLocation}`)
          .set(auth())
          .set("X-Work-Job", primary)
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/jobs/${second}`)
          .set(auth())
          .send({ archived: false })
      ).status
    ).toBe(200);
  });
});
