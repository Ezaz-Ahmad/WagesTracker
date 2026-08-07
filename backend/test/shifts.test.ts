import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("shifts", () => {
  let app: Express;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;
  let shiftIdA: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
    const a = await request(app)
      .post("/api/auth/signup")
      .send({ name: "User A", email: "user-a@example.com", password: "password-a", rate: 20 });
    tokenA = a.body.token;
    const b = await request(app)
      .post("/api/auth/signup")
      .send({ name: "User B", email: "user-b@example.com", password: "password-b", rate: 25 });
    tokenB = b.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("creates a shift for the authenticated user", async () => {
    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "2026-01-05", location: "Downtown", signIn: "09:00", signOut: "17:00" });
    expect(res.status).toBe(201);
    expect(res.body.shift.id).toBeTypeOf("string");
    expect(res.body.shift.location).toBe("Downtown");
    shiftIdA = res.body.shift.id;
  });

  it("rejects a shift with a malformed time", async () => {
    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "2026-01-05", signIn: "25:99", signOut: "17:00" });
    expect(res.status).toBe(400);
  });

  it("rejects a shift with a malformed date", async () => {
    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "not-a-date", signIn: "09:00", signOut: "17:00" });
    expect(res.status).toBe(400);
  });

  it("keeps each user's shift list scoped to their own data", async () => {
    const resA = await request(app).get("/api/shifts").set("Authorization", `Bearer ${tokenA}`);
    const resB = await request(app).get("/api/shifts").set("Authorization", `Bearer ${tokenB}`);
    expect(resA.body.shifts).toHaveLength(1);
    expect(resB.body.shifts).toEqual([]); // user B has never created a shift
  });

  it("blocks user B from reading user A's shift by id (PATCH sees it as not found)", async () => {
    const res = await request(app)
      .patch(`/api/shifts/${shiftIdA}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ location: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("blocks user B from deleting user A's shift", async () => {
    const res = await request(app).delete(`/api/shifts/${shiftIdA}`).set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("left user A's shift completely untouched by user B's attempts", async () => {
    const res = await request(app).get("/api/shifts").set("Authorization", `Bearer ${tokenA}`);
    expect(res.body.shifts).toHaveLength(1);
    expect(res.body.shifts[0].location).toBe("Downtown"); // not "Hijacked", and not deleted
  });

  it("lets the owner edit their own shift", async () => {
    const res = await request(app)
      .patch(`/api/shifts/${shiftIdA}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ location: "Uptown" });
    expect(res.status).toBe(200);
    expect(res.body.shift.location).toBe("Uptown");
  });

  it("lets the owner delete their own shift", async () => {
    const res = await request(app).delete(`/api/shifts/${shiftIdA}`).set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(204);
    const after = await request(app).get("/api/shifts").set("Authorization", `Bearer ${tokenA}`);
    expect(after.body.shifts).toEqual([]);
  });

  it("creates an active (still-clocked-in) shift with a sign-in but no sign-out", async () => {
    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "2026-01-06", location: "Downtown", signIn: "09:00" });
    expect(res.status).toBe(201);
    expect(res.body.shift.signIn).toBe("09:00");
    expect(res.body.shift.signOut).toBeNull();

    // ...and can be completed later with a PATCH adding the sign-out.
    const patched = await request(app)
      .patch(`/api/shifts/${res.body.shift.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ signOut: "17:00" });
    expect(patched.status).toBe(200);
    expect(patched.body.shift.signIn).toBe("09:00");
    expect(patched.body.shift.signOut).toBe("17:00");
  });

  it("rejects a shift with identical sign-in and sign-out (zero-length, not a real shift)", async () => {
    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "2026-01-07", signIn: "09:00", signOut: "09:00" });
    expect(res.status).toBe(400);
  });

  it("rejects a sign-out earlier than sign-in — overnight shifts aren't supported", async () => {
    const created = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "2026-01-08", signIn: "22:00", signOut: "06:00" });
    expect(created.status).toBe(400);

    // Same rule applies on PATCH: completing an existing sign-in-only shift
    // with an earlier sign-out must be rejected too, not just at creation.
    const openShift = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: "2026-01-08", signIn: "22:00" });
    expect(openShift.status).toBe(201);
    const patched = await request(app)
      .patch(`/api/shifts/${openShift.body.shift.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ signOut: "06:00" });
    expect(patched.status).toBe(400);
  });
});
