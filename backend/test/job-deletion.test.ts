import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import type { Express } from "express";
import { createTestApp, cleanupTestDb } from "./testApp.js";

describe("permanent job deletion", () => {
  let app: Express, db: Client, dbPath: string;
  beforeAll(async () => { ({ app, db, dbPath } = await createTestApp()); });
  afterAll(() => { db.close(); cleanupTestDb(dbPath); });
  async function account() {
    const name = `Employer ${randomUUID().slice(0, 8)}`;
    const signup = await request(app).post("/api/auth/signup").send({ name: "Job owner", email: `${randomUUID()}@example.com`, password: "correct horse battery staple", rate: 30, workLocationName: name });
    expect(signup.status).toBe(201);
    const auth = { Authorization: `Bearer ${signup.body.token}` };
    const jobs = await request(app).get("/api/jobs").set(auth);
    return { auth, userId: signup.body.user.id as string, job: jobs.body.jobs[0] as { id: string; name: string } };
  }
  async function seed(userId: string, jobId: string) {
    const now = new Date().toISOString(), locationId = randomUUID(), categoryId = randomUUID();
    await db.batch([
      { sql: "INSERT INTO work_locations(id,user_id,job_id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,'Branch',?,?,?)", args: [locationId, userId, jobId, `${jobId}:${locationId}`, now, now] },
      { sql: "INSERT INTO shifts(id,user_id,job_id,date,work_location_id,sign_in,sign_out,applied_rate_cents,created_at,updated_at) VALUES(?,?,?,'2026-11-16',?,'2026-11-16T09:00:00Z','2026-11-16T10:00:00Z',3000,?,?)", args: [randomUUID(), userId, jobId, locationId, now, now] },
      { sql: "INSERT INTO day_expenses(id,user_id,job_id,date,fuel_cost,created_at,updated_at) VALUES(?,?,?,'2026-11-16',10,?,?)", args: [randomUUID(), userId, jobId, now, now] },
      { sql: "INSERT INTO week_extras(id,user_id,job_id,week_start,effective_date,amount,created_at,updated_at) VALUES(?,?,?,'2026-11-16','2026-11-22',25,?,?)", args: [randomUUID(), userId, jobId, now, now] },
      { sql: "INSERT INTO spending_categories(id,user_id,name,icon,colour,created_at,updated_at) VALUES(?,?,?,'shopping-bag','orange',?,?)", args: [categoryId, userId, `Work purchases ${jobId}`, now, now] },
      { sql: "INSERT INTO personal_expenses(id,user_id,job_id,category_id,amount_cents,spent_at,spent_date,time_zone,created_at,updated_at) VALUES(?,?,?,?,1500,?,'2026-11-16','Australia/Sydney',?,?)", args: [randomUUID(), userId, jobId, categoryId, now, now, now] },
    ], "write");
    return { categoryId };
  }
  async function count(table: string, userId: string, jobId: string) { return Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE user_id=? AND job_id=?`, args: [userId, jobId] })).rows[0].n); }
  const related = ["shifts", "work_locations", "pay_rates", "day_expenses", "week_extras", "personal_expenses"];

  it("reports owned record counts and protects both preview and delete from other accounts", async () => {
    const owner = await account(), outsider = await account();
    await seed(owner.userId, owner.job.id);
    const impact = await request(app).get(`/api/jobs/${owner.job.id}/deletion-impact`).set(owner.auth);
    expect(impact.status).toBe(200);
    expect(impact.body).toMatchObject({ jobId: owner.job.id, name: owner.job.name, lastJob: true, hasRunningShift: false, counts: { shifts: 1, locations: 2, payRates: 1, fuelAllowances: 1, weeklyExtras: 1, linkedExpenses: 1 } });
    expect((await request(app).get(`/api/jobs/${owner.job.id}/deletion-impact`).set(outsider.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/jobs/${owner.job.id}`).set(outsider.auth).send({ confirmationName: owner.job.name, userId: owner.userId })).status).toBe(404);
    expect((await request(app).delete(`/api/jobs/${owner.job.id}`).send({ confirmationName: owner.job.name })).status).toBe(401);
    expect(await count("shifts", owner.userId, owner.job.id)).toBe(1);
  });

  it("requires the current job name and refuses a stale confirmation after a rename", async () => {
    const owner = await account();
    expect((await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({})).status).toBe(400);
    expect((await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ confirmationName: "wrong employer" })).status).toBe(409);
    await request(app).patch(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ name: "Renamed employer" });
    expect((await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ confirmationName: owner.job.name })).status).toBe(409);
    expect((await request(app).get("/api/jobs").set(owner.auth)).body.jobs).toHaveLength(1);
  });

  it("deletes every related record while preserving other jobs, account data and unlinked spending", async () => {
    const owner = await account(), outsider = await account();
    const next = (await request(app).post("/api/jobs").set(owner.auth).send({ name: "Next employer", rate: 42, weekStartsOn: "Wednesday", goalHours: 20 })).body.job;
    const { categoryId } = await seed(owner.userId, owner.job.id);
    await seed(owner.userId, next.id); await seed(outsider.userId, outsider.job.id);
    const now = new Date().toISOString();
    await db.execute({ sql: "INSERT INTO personal_expenses(id,user_id,category_id,amount_cents,spent_at,spent_date,time_zone,created_at,updated_at) VALUES(?,?,?,1000,?,'2026-11-16','Australia/Sydney',?,?)", args: [randomUUID(), owner.userId, categoryId, now, now, now] });
    const deleted = await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ confirmationName: owner.job.name });
    expect(deleted.status).toBe(200); expect(deleted.body.nextJobId).toBe(next.id);
    expect(deleted.body.user).toMatchObject({ rate: 42, workLocationName: "Next employer", weekStartsOn: "Wednesday", goalHours: 20 });
    for (const table of related) { expect(await count(table, owner.userId, owner.job.id)).toBe(0); expect(await count(table, owner.userId, next.id)).toBeGreaterThan(0); expect(await count(table, outsider.userId, outsider.job.id)).toBeGreaterThan(0); }
    expect(Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM personal_expenses WHERE user_id=? AND job_id IS NULL", args: [owner.userId] })).rows[0].n)).toBe(1);
    const jobs = (await request(app).get("/api/jobs").set(owner.auth)).body.jobs;
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ id: next.id, isPrimary: true });
    expect((await request(app).get("/api/shifts?from=2026-11-16&to=2026-11-16").set(owner.auth)).body.shifts).toHaveLength(1);
    expect((await request(app).patch("/api/me").set(owner.auth).send({ rate: 44, weekStartsOn: "Thursday" })).status).toBe(200);
    expect((await request(app).get(`/api/jobs/${next.id}/rates`).set(owner.auth)).body.rates.some((rate: { rate: number }) => rate.rate === 44)).toBe(true);
    expect((await request(app).get("/api/jobs").set(owner.auth)).body.jobs).toHaveLength(1);
  });

  it("protects the last job and all its data until another job has been added", async () => {
    const owner = await account(); await seed(owner.userId, owner.job.id);
    const blocked = await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ confirmationName: owner.job.name });
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe("LAST_JOB_REQUIRED");
    expect(blocked.body.error).toContain(owner.job.name);
    for (const table of related) expect(await count(table, owner.userId, owner.job.id)).toBeGreaterThan(0);
    const { migrateJobs } = await import("../src/jobMigration.js");
    await migrateJobs(db); await migrateJobs(db);
    expect((await request(app).get("/api/jobs").set(owner.auth)).body.jobs[0].id).toBe(owner.job.id);
    const fresh = await request(app).post("/api/jobs").set(owner.auth).send({ name: "Next job", rate: 35 });
    expect(fresh.status).toBe(201);
    expect((await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ confirmationName: owner.job.name })).status).toBe(200);
    expect((await request(app).get("/api/jobs").set(owner.auth)).body.jobs).toHaveLength(1);
    expect((await request(app).delete(`/api/jobs/${fresh.body.job.id}`).set(owner.auth).send({ confirmationName: "Next job" })).body.code).toBe("LAST_JOB_REQUIRED");
  });

  it("blocks a running shift inside the deletion transaction without removing any records", async () => {
    const owner = await account(); await seed(owner.userId, owner.job.id);
    await request(app).post("/api/jobs").set(owner.auth).send({name:"Alternative",rate:35});
    await db.execute({ sql: "UPDATE shifts SET sign_out=NULL WHERE user_id=? AND job_id=?", args: [owner.userId, owner.job.id] });
    expect((await request(app).get(`/api/jobs/${owner.job.id}/deletion-impact`).set(owner.auth)).body.hasRunningShift).toBe(true);
    const result = await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ confirmationName: owner.job.name });
    expect(result.status).toBe(409); expect(result.body.error).toMatch(/running shift/);
    for (const table of related) expect(await count(table, owner.userId, owner.job.id)).toBeGreaterThan(0);
  });

  it("rolls back the entire cascade if a later delete fails", async () => {
    const owner = await account(); await seed(owner.userId, owner.job.id);
    await request(app).post("/api/jobs").set(owner.auth).send({name:"Alternative",rate:35});
    await db.execute(`CREATE TRIGGER test_job_delete_failure BEFORE DELETE ON work_locations WHEN OLD.user_id='${owner.userId}' BEGIN SELECT RAISE(ABORT,'Injected deletion failure'); END`);
    try {
      expect((await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({ confirmationName: owner.job.name })).status).toBe(500);
      for (const table of related) expect(await count(table, owner.userId, owner.job.id)).toBeGreaterThan(0);
      expect((await request(app).get("/api/jobs").set(owner.auth)).body.jobs).toHaveLength(2);
    } finally { await db.execute("DROP TRIGGER test_job_delete_failure"); }
  });

  it("can permanently remove a previously archived job", async () => {
    const owner = await account();
    const job = (await request(app).post("/api/jobs").set(owner.auth).send({ name: "Old employer", rate: 28 })).body.job;
    await request(app).patch(`/api/jobs/${job.id}`).set(owner.auth).send({ archived: true });
    expect((await request(app).delete(`/api/jobs/${job.id}`).set(owner.auth).send({ confirmationName: job.name })).status).toBe(200);
    expect((await request(app).delete(`/api/jobs/${job.id}`).set(owner.auth).send({ confirmationName: job.name })).status).toBe(404);
  });
  it("does not count archived alternatives as a usable replacement", async () => {
    const owner = await account();
    const archived = (await request(app).post("/api/jobs").set(owner.auth).send({name:"Old job",rate:25})).body.job;
    await request(app).patch(`/api/jobs/${archived.id}`).set(owner.auth).send({archived:true});
    expect((await request(app).get(`/api/jobs/${owner.job.id}/deletion-impact`).set(owner.auth)).body.lastActiveJob).toBe(true);
    expect((await request(app).delete(`/api/jobs/${owner.job.id}`).set(owner.auth).send({confirmationName:owner.job.name})).body.code).toBe("LAST_JOB_REQUIRED");
  });
  it("serializes competing deletions so exactly one usable job survives", async () => {
    const owner = await account();
    const second = (await request(app).post("/api/jobs").set(owner.auth).send({name:"Second job",rate:25})).body.job;
    const results = await Promise.all([owner.job,second].map(job => request(app).delete(`/api/jobs/${job.id}`).set(owner.auth).send({confirmationName:job.name})));
    expect(results.map(result=>result.status).sort()).toEqual([200,409]);
    expect(results.find(result=>result.status===409)?.body.code).toBe("LAST_JOB_REQUIRED");
    expect((await request(app).get("/api/jobs").set(owner.auth)).body.jobs).toHaveLength(1);
  });
});
