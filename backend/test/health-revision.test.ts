import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("deployment health revision", () => {
  let app: Express, dbPath: string;
  beforeAll(async () => { ({ app, dbPath } = await createTestApp()); });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => cleanupTestDb(dbPath));
  it("keeps local health checks compatible without deployment metadata", async () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "");
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200); expect(response.body).toEqual({ ok: true });
    expect(response.headers["x-app-revision"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("identifies the exact deployed public source revision", async () => {
    const revision = "a".repeat(40);
    vi.stubEnv("RENDER_GIT_COMMIT", revision);
    const response = await request(app).get("/api/health");
    expect(response.headers["x-app-revision"]).toBe(revision);
    expect(response.body).toEqual({ ok: true });
  });
  it("never reflects arbitrary environment values into a response header", async () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "unexpected-private-value\r\nX-Test: injected");
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers["x-app-revision"]).toBeUndefined();
    expect(response.headers["x-test"]).toBeUndefined();
  });
});
