import type { Express } from "express";
import request from "supertest";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("request parsing and abuse protection", () => {
  let app: Express;
  let dbPath: string;
  beforeAll(async () => { ({ app, dbPath } = await createTestApp()); });
  afterAll(() => cleanupTestDb(dbPath));

  it("rejects malformed JSON without logging submitted secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"password":"private-test-value",broken');
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Request body must contain valid JSON." });
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("bounds request size and keeps the API responsive afterward", async () => {
    const response = await request(app).post("/api/auth/login").send({ password: "x".repeat(110_000) });
    expect(response.status).toBe(413);
    expect(response.body.error).toBe("Request body is too large.");
    expect((await request(app).get("/api/health")).body).toEqual({ ok: true });
  });

  it("rejects compressed bodies with trailing bytes before creating a decoder", async () => {
    const payload = Buffer.concat([gzipSync('{"email":"fixture@example.com"}'), Buffer.from("trailing-invalid-data")]);
    const response = await request(app).post("/api/auth/login").set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(payload);
    expect(response.status).toBe(415);
    expect(response.body.error).toBe("Send an uncompressed JSON request.");
    expect((await request(app).get("/api/health")).status).toBe(200);
  });

  it("applies the general rate limit before parsing another hostile body", async () => {
    let limited = false;
    for (let i = 0; i <= 300; i++) {
      if ((await request(app).get("/api/health")).status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
    const response = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("invalid json");
    expect(response.status).toBe(429);
  });
});
