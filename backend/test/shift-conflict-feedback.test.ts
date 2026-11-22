import type { Express } from "express";
import type { Client } from "@libsql/client";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("informative shift conflicts", () => {
  let app: Express, db: Client, dbPath: string;
  beforeAll(async () => { ({ app, db, dbPath } = await createTestApp()); });
  afterAll(() => { db.close(); cleanupTestDb(dbPath); });
  async function owner(name = "City Retail") {
    const signup = await request(app).post("/api/auth/signup").send({ name: "Schedule owner", email: `schedule-${randomUUID()}@example.com`, password: "Schedule-owner-secure-2026!", rate: 30, workLocationName: name });
    expect(signup.status).toBe(201);
    const headers = { Authorization: `Bearer ${signup.body.token}`, "X-Client-Time-Zone": "UTC" };
    const jobs = await request(app).get("/api/jobs").set(headers);
    const added = await request(app).post("/api/jobs").set(headers).send({ name: "Harbour Café", rate: 25 });
    expect(added.status).toBe(201);
    return { headers, primary: jobs.body.jobs[0].id, second: added.body.job.id };
  }
  async function save(user: Awaited<ReturnType<typeof owner>>, job: string, date: string, signIn: string, signOut?: string) {
    return request(app).post("/api/shifts").set(user.headers).set("X-Work-Job", job).send({ date, location: "Newcastle", signIn, ...(signOut ? { signOut } : {}) });
  }

  it("identifies both jobs and exact hours without disclosing another user's records", async () => {
    const user = await owner(); const other = await owner("Private employer");
    expect((await save(user, user.primary, "2026-11-20", "09:00", "17:00")).status).toBe(201);
    expect((await save(other, other.primary, "2026-11-20", "10:00", "18:00")).status).toBe(201);
    const conflict = await save(user, user.second, "2026-11-20", "12:20", "18:00");
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "SHIFT_OVERLAP", conflict: { kind: "overlap", totalConflicts: 1, attempted: { jobName: "Harbour Café", date: "2026-11-20", signIn: "12:20", signOut: "18:00" }, conflicts: [{ jobName: "City Retail", location: "Newcastle", date: "2026-11-20", signIn: "09:00", signOut: "17:00" }] } });
    expect(conflict.body.error).toMatch(/City Retail.*20 Nov 2026.*9:00 am.*5:00 pm/);
    expect(JSON.stringify(conflict.body)).not.toMatch(/Private employer|user_id|applied_rate|password|token/);
    expect(Object.keys(conflict.body.conflict.conflicts[0]).sort()).toEqual(["date", "jobName", "location", "signIn", "signOut"]);
  });

  it("explains an overnight conflict on the previous calendar day and allows touching endpoints", async () => {
    const user = await owner();
    expect((await save(user, user.primary, "2026-11-19", "22:00", "06:00")).status).toBe(201);
    const conflict = await save(user, user.second, "2026-11-20", "05:30", "09:00");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/19 Nov 2026.*10:00 pm.*20 Nov 2026.*6:00 am/);
    expect(conflict.body.conflict.conflicts[0]).toMatchObject({ date: "2026-11-19", signIn: "22:00", signOut: "06:00" });
    expect((await save(user, user.second, "2026-11-20", "06:00", "09:00")).status).toBe(201);
  });

  it("lists multiple conflicts and leaves a rejected edit unchanged", async () => {
    const user = await owner();
    await save(user, user.primary, "2026-11-17", "08:00", "10:00");
    await save(user, user.primary, "2026-11-17", "14:00", "16:00");
    const existing = await save(user, user.second, "2026-11-17", "17:00", "18:00");
    const edited = await request(app).patch(`/api/shifts/${existing.body.shift.id}`).set(user.headers).set("X-Work-Job", user.second).send({ signIn: "09:00", signOut: "15:00" });
    expect(edited.status).toBe(409);
    expect(edited.body.conflict.totalConflicts).toBe(2);
    expect(edited.body.conflict.conflicts.map((shift: { signIn: string }) => shift.signIn)).toEqual(["08:00", "14:00"]);
    const rows = await request(app).get("/api/shifts?from=2026-11-17&to=2026-11-17").set(user.headers).set("X-Work-Job", user.second);
    expect(rows.body.shifts[0]).toMatchObject({ signIn: "17:00", signOut: "18:00" });
  });

  it("identifies a running job and keeps scoped Lock Screen errors private", async () => {
    const user = await owner();
    await save(user, user.primary, "2026-11-18", "09:00", "17:00");
    const open = await save(user, user.second, "2026-11-18", "08:30");
    expect(open.status).toBe(201);
    const running = await save(user, user.primary, "2026-11-19", "09:00");
    expect(running.body).toMatchObject({ code: "OPEN_SHIFT_EXISTS", conflict: { kind: "running", conflicts: [{ jobName: "Harbour Café", date: "2026-11-18", signIn: "08:30", signOut: null }] } });
    const end = await request(app).post(`/api/shifts/${open.body.shift.id}/clock-out`).set(user.headers).set("X-Work-Job", user.second).send({ signOut: "18:00" });
    expect(end.status).toBe(409);
    expect(end.body.conflict.conflicts[0].jobName).toBe("City Retail");
    const shortcut = await request(app).post(`/api/shifts/${open.body.shift.id}/clock-out-action`).set("X-Shift-Clock-Out-Token", open.body.clockOutToken).send({ signOut: "18:00" });
    expect(shortcut.status).toBe(409);
    expect(shortcut.body.code).toBe("SHIFT_OVERLAP");
    expect(shortcut.body.conflict).toBeUndefined();
    expect(JSON.stringify(shortcut.body)).not.toMatch(/City Retail|Harbour Café/);
  });
});
