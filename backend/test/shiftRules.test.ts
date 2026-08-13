// The date/time rules a shift has to satisfy, exercised through the real API.
//
// Before this feature the API enforced exactly two things: no zero-length
// shift, and no second open shift. A shift dated 2099 was accepted. Two
// shifts claiming the same hours were accepted. An am/pm slip that turned an
// 8-hour night into a 23-hour one was accepted, because with overnight
// support every pair of distinct times is a "valid" duration somewhere in
// (0, 24) and no ordering rule can separate the typo from the real thing.
//
// Historical editing makes all three much easier to hit — you type dates and
// times from memory, weeks later, with no clock-in button getting them right
// for you. So the rules apply to every write, not only historical ones.
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

const TIME_ZONE = "UTC";

/** A date `days` before today, in the server's own frame — the same frame
 * the future-date rule compares against. Fixed literals would rot: a date
 * hardcoded as "past" today is a future date next year. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysAhead(days: number): string {
  return daysAgo(-days);
}

describe("shift date and time rules", () => {
  let app: Express;
  let dbPath: string;
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp());
    const a = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Rules User", email: "rules-user@example.com", password: "rules-user-secure-2026", rate: 20 });
    token = a.body.token;
    const b = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Other User", email: "rules-other@example.com", password: "rules-other-secure-2026", rate: 20 });
    otherToken = b.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  const post = (body: unknown, t = token) => request(app).post("/api/shifts").set("X-Client-Time-Zone", TIME_ZONE).set("Authorization", `Bearer ${t}`).send(body);
  const patch = (id: string, body: unknown, t = token) =>
    request(app).patch(`/api/shifts/${id}`).set("X-Client-Time-Zone", TIME_ZONE).set("Authorization", `Bearer ${t}`).send(body);

  describe("future dates", () => {
    it("rejects a shift dated well in the future", async () => {
      const res = await post({ date: "2099-01-01", signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/future date/i);
    });

    it("rejects a date a month out, not just an absurd one", async () => {
      const res = await post({ date: daysAhead(30), signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(400);
    });

    it("rejects tomorrow with no one-day allowance", async () => {
      const res = await post({ date: daysAhead(1), signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/future date/i);
    });

    it("accepts a past date, which is the entire point of historical editing", async () => {
      const res = await post({ date: daysAgo(40), signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(201);
      await request(app).delete(`/api/shifts/${res.body.shift.id}`).set("Authorization", `Bearer ${token}`);
    });

    it("rejects a date that passes the regex but is not a real day", async () => {
      const res = await post({ date: "2026-02-30", signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(400);
    });
  });

  describe("long and overnight durations", () => {
    it("accepts a legitimate 16-hour-40-minute overnight shift", async () => {
      const res = await post({ date: daysAgo(10), signIn: "08:50", signOut: "01:30" });
      expect(res.status).toBe(201);
      expect(res.body.shift.signIn).toBe("08:50");
      expect(res.body.shift.signOut).toBe("01:30");
    });

    it("accepts a shift exactly at the warning threshold", async () => {
      const res = await post({ date: daysAgo(11), signIn: "06:00", signOut: "22:00" });
      expect(res.status).toBe(201);
    });

    it("still accepts a genuine overnight shift, which the wraparound keeps short", async () => {
      // 22:00 -> 06:00 is 8 hours, not 16 — overnight support is unchanged.
      const res = await post({ date: daysAgo(12), signIn: "22:00", signOut: "06:00" });
      expect(res.status).toBe(201);
      expect(res.body.shift.signOut).toBe("06:00");
    });

    it("does not reject a distinct pair solely because it exceeds 16 hours", async () => {
      // The exact slip the former ceiling tried to catch: the user meant 22:00 -> 06:00
      // and typed it backwards. No ordering rule can reject this, because for
      // an overnight shift 'sign-out before sign-in' is the correct order.
      const res = await post({ date: daysAgo(13), signIn: "06:00", signOut: "22:01" });
      expect(res.status).toBe(201);
    });
  });

  describe("overlapping shifts", () => {
    let firstId: string;
    const day = daysAgo(20);

    it("accepts the first shift of the day", async () => {
      const res = await post({ date: day, signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(201);
      firstId = res.body.shift.id;
    });

    it("rejects a second shift that overlaps it", async () => {
      const res = await post({ date: day, signIn: "16:00", signOut: "18:00" });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/overlaps/i);
    });

    it("rejects a shift fully contained in an existing one", async () => {
      const res = await post({ date: day, signIn: "10:00", signOut: "12:00" });
      expect(res.status).toBe(409);
    });

    it("rejects a shift that fully contains an existing one", async () => {
      const res = await post({ date: day, signIn: "08:00", signOut: "18:00" });
      expect(res.status).toBe(409);
    });

    it("allows a back-to-back shift that only touches at the boundary", async () => {
      // Split shifts are real and common. Intervals are half-open precisely
      // so 09:00-17:00 and 17:00-19:00 are neighbours, not a conflict.
      const res = await post({ date: day, signIn: "17:00", signOut: "19:00" });
      expect(res.status).toBe(201);
    });

    it("catches an overnight shift from the previous day reaching into this one", async () => {
      // The reason the overlap check looks a day either side rather than
      // only at the same date: an overnight shift is filed under the day it
      // started, so a conflict on day D can be owned by a row dated D-1.
      const night = daysAgo(31);
      const morning = daysAgo(30);
      const a = await post({ date: night, signIn: "22:00", signOut: "05:00" });
      expect(a.status).toBe(201);

      const b = await post({ date: morning, signIn: "04:00", signOut: "08:00" });
      expect(b.status).toBe(409);
      expect(b.body.error).toMatch(/overlaps/i);

      // ...and one starting after it ends is fine.
      const c = await post({ date: morning, signIn: "05:00", signOut: "08:00" });
      expect(c.status).toBe(201);
    });

    it("does not treat another user's shift as a conflict", async () => {
      // Overlap is scoped to the caller. Two people working the same hours
      // is not a data problem, and leaking it as a 409 would also disclose
      // that the other account has a shift then.
      const res = await post({ date: day, signIn: "09:00", signOut: "17:00" }, otherToken);
      expect(res.status).toBe(201);
    });

    it("does not report a shift as overlapping itself when patched", async () => {
      // Shortening it. The naive implementation compares the candidate
      // against every shift on the day including the row being edited, and
      // reports a conflict with itself for any change at all.
      const res = await patch(firstId, { signOut: "16:30" });
      expect(res.status).toBe(200);
      expect(res.body.shift.signOut).toBe("16:30");
    });

    it("rejects a patch that extends a shift onto its neighbour", async () => {
      // A 17:00-19:00 shift was added back-to-back above, so extending past
      // 17:00 is a genuine conflict.
      const res = await patch(firstId, { signOut: "17:30" });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/overlaps/i);

      // The rejected value was not written.
      const after = await request(app).get("/api/shifts").set("Authorization", `Bearer ${token}`);
      const row = after.body.shifts.find((sh: { id: string }) => sh.id === firstId);
      expect(row.signOut).toBe("16:30");
    });
  });

  describe("editing long shifts", () => {
    let longShiftId: string;

    it("creates a long shift through the API", async () => {
      const created = await post({ date: daysAgo(50), signIn: "08:00", signOut: "00:30" });
      expect(created.status).toBe(201);
      longShiftId = created.body.shift.id;
    });

    it("still allows the location to be corrected", async () => {
      const res = await patch(longShiftId, { location: "Corrected Store" });
      expect(res.status).toBe(200);
      expect(res.body.shift.location).toBe("Corrected Store");
      // Updating metadata leaves the intentional times exactly as entered.
      expect(res.body.shift.signOut).toBe("00:30");
    });

    it("allows its times to be corrected to another intentional long duration", async () => {
      const res = await patch(longShiftId, { signOut: "00:29" });
      expect(res.status).toBe(200);
      expect(res.body.shift.signOut).toBe("00:29");
    });

    it("and accepts a change that brings it back within the rules", async () => {
      const res = await patch(longShiftId, { signOut: "16:00" });
      expect(res.status).toBe(200);
      expect(res.body.shift.signOut).toBe("16:00");
    });
  });

  describe("ownership", () => {
    let mineId: string;

    it("creates a shift owned by the caller", async () => {
      const res = await post({ date: daysAgo(60), signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(201);
      mineId = res.body.shift.id;
    });

    it("refuses to let another user patch it", async () => {
      const res = await patch(mineId, { signOut: "18:00" }, otherToken);
      expect(res.status).toBe(404);
    });

    it("refuses to let another user delete it", async () => {
      const res = await request(app).delete(`/api/shifts/${mineId}`).set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(404);
    });

    it("404s rather than 403s, so the response cannot confirm the shift exists", async () => {
      // Account-enumeration hygiene, same reasoning as the login endpoint's
      // single "incorrect email or password".
      const real = await patch(mineId, { signOut: "18:00" }, otherToken);
      const invented = await patch("00000000-0000-4000-8000-000000000000", { signOut: "18:00" }, otherToken);
      expect(real.status).toBe(invented.status);
      expect(real.body.error).toBe(invented.body.error);
    });

    it("ignores a client-supplied userId in the payload", async () => {
      // The user comes from the verified token, never the body.
      const res = await post({ date: daysAgo(61), signIn: "09:00", signOut: "17:00", userId: "someone-else" });
      expect(res.status).toBe(201);

      const mine = await request(app).get("/api/shifts").set("Authorization", `Bearer ${token}`);
      expect(mine.body.shifts.some((s: { id: string }) => s.id === res.body.shift.id)).toBe(true);

      const theirs = await request(app).get("/api/shifts").set("Authorization", `Bearer ${otherToken}`);
      expect(theirs.body.shifts.some((s: { id: string }) => s.id === res.body.shift.id)).toBe(false);
    });

    it("requires authentication at all", async () => {
      const res = await request(app).post("/api/shifts").send({ date: daysAgo(1), signIn: "09:00", signOut: "17:00" });
      expect(res.status).toBe(401);
    });
  });
});
