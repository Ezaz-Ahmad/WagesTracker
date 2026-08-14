import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { cleanupTestDb, createTestApp } from "./testApp.js";

const WEB_ORIGIN = "https://wages-tracker-frontend.vercel.app";
const IOS_ORIGIN = "capacitor://localhost";

let app: Express;
let dbPath: string;

beforeAll(async () => {
  const test = await createTestApp();
  dbPath = test.dbPath;

  process.env.NODE_ENV = "production";
  process.env.ALLOWED_ORIGINS = `${WEB_ORIGIN},${IOS_ORIGIN}`;
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterAll(() => {
  cleanupTestDb(dbPath);
});

describe("production CORS allowlist", () => {
  it.each([WEB_ORIGIN, IOS_ORIGIN])("accepts the trusted origin %s", async (origin) => {
    const response = await request(app)
      .options("/api/health")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,content-type,x-client-time-zone");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers.vary).toContain("Origin");
    expect(response.headers["access-control-allow-headers"].toLowerCase()).toContain("authorization");
    expect(response.headers["access-control-allow-headers"].toLowerCase()).toContain("content-type");
    expect(response.headers["access-control-allow-headers"].toLowerCase()).toContain("x-client-time-zone");
  });

  it("continues exposing the replacement-token response header", async () => {
    const response = await request(app).get("/api/health").set("Origin", IOS_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(IOS_ORIGIN);
    expect(response.headers["access-control-expose-headers"].toLowerCase()).toContain("x-new-token");
  });

  it("rejects an unknown origin without reflecting it", async () => {
    const origin = "https://attacker.example";
    const response = await request(app).get("/api/health").set("Origin", origin);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
