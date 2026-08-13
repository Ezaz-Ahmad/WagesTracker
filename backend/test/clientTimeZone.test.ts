import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";
import { isSupportedIanaTimeZone, localDateForTimeZone } from "../src/security/shiftRules.js";

describe("client timezone on shift writes", () => {
  let app: Express;
  let dbPath: string;
  let token: string;

  beforeAll(async () => {
    ({ app, dbPath } = await createTestApp(false));
    const signup = await request(app).post("/api/auth/signup").send({
      name: "Timezone User", email: "timezone@example.com", password: "timezone-user-secure-2026", rate: 20,
    });
    token = signup.body.token;
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => cleanupTestDb(dbPath));

  const post = (date: string, timeZone?: string) => {
    const call = request(app).post("/api/shifts").set("Authorization", `Bearer ${token}`);
    if (timeZone !== undefined) call.set("X-Client-Time-Zone", timeZone);
    return call.send({ date, signIn: "22:00", signOut: "06:00" });
  };

  it.each(["Australia/Sydney", "Pacific/Auckland", "America/New_York", "Asia/Kolkata", "UTC"])(
    "accepts the supported IANA timezone %s",
    (zone) => expect(isSupportedIanaTimeZone(zone)).toBe(true)
  );

  it.each(["+10:00", "-0500", "Mars/Olympus_Mons", ""])("rejects invalid timezone %s", (zone) => {
    expect(isSupportedIanaTimeZone(zone)).toBe(false);
  });

  it("derives different local dates at a UTC/local-date boundary", () => {
    const now = new Date("2026-08-13T14:30:00.000Z");
    expect(localDateForTimeZone(now, "UTC")).toBe("2026-08-13");
    expect(localDateForTimeZone(now, "Australia/Sydney")).toBe("2026-08-14");
    expect(localDateForTimeZone(now, "America/New_York")).toBe("2026-08-13");
  });

  it("uses daylight-saving rules at the Sydney transition", () => {
    expect(localDateForTimeZone(new Date("2026-10-03T14:30:00.000Z"), "Australia/Sydney")).toBe("2026-10-04");
    expect(localDateForTimeZone(new Date("2026-10-04T13:30:00.000Z"), "Australia/Sydney")).toBe("2026-10-05");
  });

  it("accepts today, including an overnight shift ending tomorrow", async () => {
    const today = localDateForTimeZone(new Date(), "Australia/Sydney");
    const res = await post(today, "Australia/Sydney");
    expect(res.status).toBe(201);
    expect(res.body.shift.signOut).toBe("06:00");
  });

  it("rejects tomorrow in the request timezone", async () => {
    const today = localDateForTimeZone(new Date(), "Australia/Sydney");
    const tomorrowDate = new Date(`${today}T00:00:00Z`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const res = await post(tomorrowDate.toISOString().slice(0, 10), "Australia/Sydney");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future date/i);
  });

  it("rejects a missing or invalid header with a clear validation code", async () => {
    const missing = await post("2026-01-01");
    const invalid = await post("2026-01-01", "+10:00");
    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(missing.body.code).toBe("INVALID_CLIENT_TIME_ZONE");
    expect(invalid.body.code).toBe("INVALID_CLIENT_TIME_ZONE");
  });
});
