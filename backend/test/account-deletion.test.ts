import type { Client } from "@libsql/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

describe("account deletion", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let token: string;
  const email = "delete-me@example.com";
  const password = "delete-me-securely-1";

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
    const signup = await request(app).post("/api/auth/signup").send({ name: "Deletable User", email, password, rate: 20 });
    token = signup.body.token;

    // Leave a row behind in every table that references this user, so
    // deletion actually has something real to prove it cleaned up — an
    // account with nothing but a `users` row would pass even a deletion
    // that silently ignored the other three tables.
    await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2026-01-05", signIn: "09:00", signOut: "17:00" });
    await request(app).put("/api/day-expenses/2026-01-05").set("Authorization", `Bearer ${token}`).send({ fuelCost: 12.5 });
    await request(app)
      .put("/api/week-extras/2026-01-05")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 40, reason: "Holiday bonus" });
    const categories = await request(app).get("/api/spending/categories").set("Authorization", `Bearer ${token}`);
    await request(app)
      .post("/api/spending/expenses")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Client-Time-Zone", "UTC")
      .send({ amountCents: 1250, categoryId: categories.body.categories[0].id, spentAt: "2026-01-05T12:00" });
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("rejects deletion with the wrong password", async () => {
    const res = await request(app).delete("/api/me").set("Authorization", `Bearer ${token}`).send({ password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("deletes the account when the correct password is given", async () => {
    const res = await request(app).delete("/api/me").set("Authorization", `Bearer ${token}`).send({ password });
    expect(res.status).toBe(204);
  });

  it("can no longer log in as the deleted user", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(401);
  });

  it("removed the user's row from every table that referenced them, including their sessions", async () => {
    const [users, shifts, dayExpenses, weekExtras, sessions, personalExpenses, spendingCategories] = await Promise.all([
      db.execute("SELECT COUNT(*) as c FROM users"),
      db.execute("SELECT COUNT(*) as c FROM shifts"),
      db.execute("SELECT COUNT(*) as c FROM day_expenses"),
      db.execute("SELECT COUNT(*) as c FROM week_extras"),
      db.execute("SELECT COUNT(*) as c FROM user_sessions"),
      db.execute("SELECT COUNT(*) as c FROM personal_expenses"),
      db.execute("SELECT COUNT(*) as c FROM spending_categories"),
    ]);
    expect(Number(users.rows[0].c)).toBe(0);
    expect(Number(shifts.rows[0].c)).toBe(0);
    expect(Number(dayExpenses.rows[0].c)).toBe(0);
    expect(Number(weekExtras.rows[0].c)).toBe(0);
    expect(Number(sessions.rows[0].c)).toBe(0);
    expect(Number(personalExpenses.rows[0].c)).toBe(0);
    expect(Number(spendingCategories.rows[0].c)).toBe(0);
  });
});
