// The server side of historical editing and per-week PDFs.
//
// PDF generation is client-side (jsPDF in the browser), so there is no PDF
// endpoint to test. What the server is responsible for is the data a PDF is
// built from: that a week's range returns that week's rows and nobody
// else's, that a correction is durably persisted and visible on the next
// read, and that no amount of manipulating a request lets one account reach
// another's records. Those are the properties a "can user B download user
// A's week?" test would actually be checking, so they are checked directly.
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

/** A Monday in the past, and the Sunday that closes its week. Fixed dates
 * are safe here because they are firmly historical and the future-date rule
 * only looks forward. */
const WEEK_START = "2026-01-26";
const WEEK_END = "2026-02-01";
const PREV_WEEK_START = "2026-01-19";
const PREV_WEEK_END = "2026-01-25";

describe("historical week data", () => {
  let app: Express;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;
  let shiftA: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
    const a = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Hist A", email: "hist-a@example.com", password: "hist-a-secure-pass-2026", rate: 20 });
    tokenA = a.body.token;
    const b = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Hist B", email: "hist-b@example.com", password: "hist-b-secure-pass-2026", rate: 30 });
    tokenB = b.body.token;

    // A's week: 4 hours on the Monday. Plus a shift in the previous week, so
    // range filtering has something to exclude.
    const created = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: WEEK_START, location: "Downtown", signIn: "09:00", signOut: "13:00" });
    shiftA = created.body.shift.id;

    await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: PREV_WEEK_START, location: "Uptown", signIn: "09:00", signOut: "12:00" });

    // B works the identical hours in the same week. Nothing about that is a
    // conflict, and neither user should ever see the other's row.
    await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ date: WEEK_START, location: "Elsewhere", signIn: "09:00", signOut: "13:00" });
  });
  afterAll(() => cleanupTestDb(dbPath));

  const weekOf = (token: string, from: string, to: string) =>
    request(app).get(`/api/shifts?from=${from}&to=${to}`).set("Authorization", `Bearer ${token}`);

  describe("selecting a week", () => {
    it("returns the requested week's rows and excludes neighbouring weeks", async () => {
      const res = await weekOf(tokenA, WEEK_START, WEEK_END);
      expect(res.status).toBe(200);
      expect(res.body.shifts).toHaveLength(1);
      expect(res.body.shifts[0].date).toBe(WEEK_START);
      expect(res.body.shifts[0].location).toBe("Downtown");
    });

    it("returns a different week when a different range is asked for", async () => {
      const res = await weekOf(tokenA, PREV_WEEK_START, PREV_WEEK_END);
      expect(res.body.shifts).toHaveLength(1);
      expect(res.body.shifts[0].location).toBe("Uptown");
    });

    it("includes both boundary days of the range", async () => {
      // Off-by-one at a week boundary silently drops a Sunday's hours from
      // every total and every PDF.
      await request(app)
        .post("/api/shifts")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ date: WEEK_END, location: "Sunday shift", signIn: "10:00", signOut: "14:00" });

      const res = await weekOf(tokenA, WEEK_START, WEEK_END);
      const dates = res.body.shifts.map((s: { date: string }) => s.date);
      expect(dates).toContain(WEEK_START);
      expect(dates).toContain(WEEK_END);
    });
  });

  describe("isolation between accounts", () => {
    it("never returns another user's rows for the same week", async () => {
      const mine = await weekOf(tokenA, WEEK_START, WEEK_END);
      expect(mine.body.shifts.every((s: { location: string }) => s.location !== "Elsewhere")).toBe(true);

      const theirs = await weekOf(tokenB, WEEK_START, WEEK_END);
      expect(theirs.body.shifts).toHaveLength(1);
      expect(theirs.body.shifts[0].location).toBe("Elsewhere");
    });

    it("ignores a userId supplied in the query string", async () => {
      // There is no user parameter — the account comes from the verified
      // token. Adding one changes nothing, which is the point.
      const res = await request(app)
        .get(`/api/shifts?from=${WEEK_START}&to=${WEEK_END}&userId=someone-else`)
        .set("Authorization", `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      expect(res.body.shifts.every((s: { location: string }) => s.location === "Elsewhere")).toBe(true);
    });

    it("refuses an unauthenticated read of any week", async () => {
      const res = await request(app).get(`/api/shifts?from=${WEEK_START}&to=${WEEK_END}`);
      expect(res.status).toBe(401);
    });

    it("refuses a read with a token that is not a valid session", async () => {
      const res = await request(app)
        .get(`/api/shifts?from=${WEEK_START}&to=${WEEK_END}`)
        .set("Authorization", "Bearer not-a-real-token");
      expect(res.status).toBe(401);
      // One opaque failure, not a hint about which part was wrong.
      expect(res.body.error).toBe("Invalid or expired token");
    });
  });

  describe("a correction is durable and visible to the next read", () => {
    it("persists an edited historical shift", async () => {
      const patched = await request(app)
        .patch(`/api/shifts/${shiftA}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ signOut: "15:00" });
      expect(patched.status).toBe(200);

      // Re-read from scratch, exactly as a fresh sign-in on another device
      // would. This is what makes the change real rather than local state.
      const res = await weekOf(tokenA, WEEK_START, WEEK_END);
      const row = res.body.shifts.find((s: { id: string }) => s.id === shiftA);
      expect(row.signOut).toBe("15:00");
    });

    it("shows a newly added historical day on the next read", async () => {
      const created = await request(app)
        .post("/api/shifts")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ date: "2026-01-28", location: "Added later", signIn: "10:00", signOut: "12:00" });
      expect(created.status).toBe(201);

      const res = await weekOf(tokenA, WEEK_START, WEEK_END);
      expect(res.body.shifts.some((s: { date: string }) => s.date === "2026-01-28")).toBe(true);
    });

    it("removes a deleted historical day from the next read", async () => {
      const created = await request(app)
        .post("/api/shifts")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ date: "2026-01-30", location: "Mistake", signIn: "08:00", signOut: "09:00" });
      const id = created.body.shift.id;

      const removed = await request(app).delete(`/api/shifts/${id}`).set("Authorization", `Bearer ${tokenA}`);
      expect(removed.status).toBe(204);

      const res = await weekOf(tokenA, WEEK_START, WEEK_END);
      expect(res.body.shifts.some((s: { id: string }) => s.id === id)).toBe(false);
    });

    it("leaves neighbouring weeks untouched by an edit", async () => {
      // A partial update that quietly altered an unrelated week would be
      // invisible on the screen where the edit was made.
      const before = await weekOf(tokenA, PREV_WEEK_START, PREV_WEEK_END);
      await request(app).patch(`/api/shifts/${shiftA}`).set("Authorization", `Bearer ${tokenA}`).send({ signOut: "16:00" });
      const after = await weekOf(tokenA, PREV_WEEK_START, PREV_WEEK_END);
      expect(after.body.shifts).toEqual(before.body.shifts);
    });

    it("leaves the other account's identical week untouched", async () => {
      const res = await weekOf(tokenB, WEEK_START, WEEK_END);
      expect(res.body.shifts).toHaveLength(1);
      expect(res.body.shifts[0].signOut).toBe("13:00");
    });
  });

  describe("the display name a PDF is titled with", () => {
    it("comes from the authenticated profile", async () => {
      // The client builds the filename from this, so it must be the account's
      // own name and not anything the request supplied.
      const a = await request(app).get("/api/me").set("Authorization", `Bearer ${tokenA}`);
      expect(a.body.user.name).toBe("Hist A");
      const b = await request(app).get("/api/me").set("Authorization", `Bearer ${tokenB}`);
      expect(b.body.user.name).toBe("Hist B");
    });

    it("follows a rename, so a later PDF carries the current name", async () => {
      await request(app).patch("/api/me").set("Authorization", `Bearer ${tokenA}`).send({ name: "Hist A Renamed" });
      const res = await request(app).get("/api/me").set("Authorization", `Bearer ${tokenA}`);
      expect(res.body.user.name).toBe("Hist A Renamed");
    });

    it("never exposes another account's profile", async () => {
      const res = await request(app).get("/api/me").set("Authorization", `Bearer ${tokenB}`);
      expect(res.body.user.email).toBe("hist-b@example.com");
      expect(res.body.user.name).not.toContain("Hist A");
    });
  });

  describe("error responses stay opaque", () => {
    it("does not leak internals when a shift cannot be found", async () => {
      const res = await request(app)
        .patch("/api/shifts/00000000-0000-4000-8000-000000000000")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ signOut: "18:00" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Shift not found");
      expect(JSON.stringify(res.body)).not.toMatch(/sql|sqlite|stack|at Object|user_id/i);
    });

    it("does not leak internals on a validation failure", async () => {
      const res = await request(app)
        .post("/api/shifts")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ date: "not-a-date", signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/sql|sqlite|stack|at Object/i);
    });
  });
});
