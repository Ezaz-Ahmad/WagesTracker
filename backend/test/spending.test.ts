import type { Client } from "@libsql/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

const ZONE = "Australia/Sydney";

describe("personal spending", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;
  let groceriesId: string;
  let transportId: string;
  let customId: string;
  let expenseId: string;

  const auth = (token = tokenA) => ({ Authorization: `Bearer ${token}` });
  const expense = (body: Record<string, unknown>, token = tokenA) =>
    request(app).post("/api/spending/expenses").set(auth(token)).set("X-Client-Time-Zone", ZONE).send(body);

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp());
    const a = await request(app).post("/api/auth/signup").send({
      name: "Spending User A", email: "spending-a@example.com", password: "spending-user-a-secure-2026", rate: 20,
    });
    const b = await request(app).post("/api/auth/signup").send({
      name: "Spending User B", email: "spending-b@example.com", password: "spending-user-b-secure-2026", rate: 30,
    });
    tokenA = a.body.token;
    tokenB = b.body.token;
  });
  afterAll(() => cleanupTestDb(dbPath));

  it("requires authentication on every spending resource", async () => {
    const results = await Promise.all([
      request(app).get("/api/spending/categories"),
      request(app).get("/api/spending/expenses"),
      request(app).get("/api/spending/summary?from=2026-08-03&to=2026-08-09"),
      request(app).post("/api/spending/categories").send({ name: "X", icon: "other", colour: "#475569" }),
    ]);
    expect(results.map((result) => result.status)).toEqual([401, 401, 401, 401]);
  });

  it("creates the 11 useful default categories", async () => {
    const result = await request(app).get("/api/spending/categories").set(auth());
    expect(result.status).toBe(200);
    expect(result.body.categories).toHaveLength(11);
    expect(result.body.categories.map((category: { name: string }) => category.name)).toEqual(expect.arrayContaining([
      "Food & dining", "Groceries", "Transport", "Rent & housing", "Bills & utilities", "Shopping",
      "Health", "Entertainment", "Education", "Family", "Other",
    ]));
    groceriesId = result.body.categories.find((category: { name: string }) => category.name === "Groceries").id;
    transportId = result.body.categories.find((category: { name: string }) => category.name === "Transport").id;
  });

  it("seeds defaults idempotently", async () => {
    await request(app).get("/api/spending/categories").set(auth());
    await request(app).get("/api/spending/categories").set(auth());
    const count = await db.execute("SELECT COUNT(*) AS count FROM spending_categories");
    expect(Number(count.rows[0].count)).toBe(11);
  });

  it("creates and edits a trimmed custom category", async () => {
    const created = await request(app).post("/api/spending/categories").set(auth()).send({
      name: "  Coffee   runs  ", icon: "dining", colour: "#B45309",
    });
    expect(created.status).toBe(201);
    expect(created.body.category).toMatchObject({ name: "Coffee runs", icon: "dining", colour: "#B45309", isDefault: false, archived: false });
    customId = created.body.category.id;

    const edited = await request(app).patch(`/api/spending/categories/${customId}`).set(auth()).send({
      name: "Cafe", icon: "other", colour: "#475569",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.category).toMatchObject({ name: "Cafe", icon: "other", colour: "#475569" });
  });

  it("prevents duplicate active names case-insensitively", async () => {
    const duplicate = await request(app).post("/api/spending/categories").set(auth()).send({
      name: "  cAfE ", icon: "other", colour: "#475569",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already have/i);
  });

  it("rejects arbitrary icons and colours", async () => {
    const badIcon = await request(app).post("/api/spending/categories").set(auth()).send({ name: "Bad", icon: "<svg>", colour: "#475569" });
    const badColour = await request(app).post("/api/spending/categories").set(auth()).send({ name: "Bad", icon: "other", colour: "url(javascript:1)" });
    expect(badIcon.status).toBe(400);
    expect(badColour.status).toBe(400);
  });

  it("keeps category reads and writes isolated by owner", async () => {
    const listB = await request(app).get("/api/spending/categories?includeArchived=true").set(auth(tokenB));
    expect(listB.body.categories.some((category: { name: string }) => category.name === "Cafe")).toBe(false);
    const patch = await request(app).patch(`/api/spending/categories/${customId}`).set(auth(tokenB)).send({ name: "Stolen" });
    const archive = await request(app).delete(`/api/spending/categories/${customId}`).set(auth(tokenB));
    expect(patch.status).toBe(404);
    expect(archive.status).toBe(404);
  });

  it("rejects expense writes without a supported IANA timezone", async () => {
    const body = { amountCents: 500, categoryId: groceriesId, spentAt: "2026-08-03T10:30" };
    const missing = await request(app).post("/api/spending/expenses").set(auth()).send(body);
    const offset = await request(app).post("/api/spending/expenses").set(auth()).set("X-Client-Time-Zone", "+10:00").send(body);
    expect(missing.status).toBe(400);
    expect(offset.status).toBe(400);
    expect(missing.body.code).toBe("INVALID_CLIENT_TIME_ZONE");
  });

  it.each([0, -1, 1.25, 100_000_001, "10.00"])("rejects malformed amount %s", async (amountCents) => {
    const result = await expense({ amountCents, categoryId: groceriesId, spentAt: "2026-08-03T10:30" });
    expect(result.status).toBe(400);
  });

  it("rejects a future local date and preserves an accepted local calendar date", async () => {
    const future = await expense({ amountCents: 500, categoryId: groceriesId, spentAt: "2099-01-01T00:15" });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/future/i);

    const created = await expense({
      amountCents: 5000,
      categoryId: groceriesId,
      spentAt: "2026-08-03T00:15",
      merchant: "Night market",
      note: "Local date boundary",
      paymentMethod: "card",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
    });
    expect(created.status).toBe(201);
    expect(created.body.expense).toMatchObject({ amountCents: 5000, spentDate: "2026-08-03", spentAt: "2026-08-03T00:15", timeZone: ZONE });
    expenseId = created.body.expense.id;
  });

  it("makes repeated create/retry requests idempotent", async () => {
    const body = {
      amountCents: 5000, categoryId: groceriesId, spentAt: "2026-08-03T00:15", merchant: "Night market",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
    };
    const retried = await expense(body);
    expect(retried.status).toBe(200);
    expect(retried.body.expense.id).toBe(expenseId);
    const count = await db.execute({ sql: "SELECT COUNT(*) AS count FROM personal_expenses WHERE client_request_id = ?", args: [body.clientRequestId] });
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it("makes simultaneous retry requests idempotent at the database boundary", async () => {
    const body = {
      amountCents: 725, categoryId: groceriesId, spentAt: "2026-08-03T08:15", merchant: "Concurrent retry",
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    const [first, second] = await Promise.all([expense(body), expense(body)]);
    expect([200, 201]).toContain(first.status);
    expect([200, 201]).toContain(second.status);
    expect(first.body.expense.id).toBe(second.body.expense.id);
    const count = await db.execute({ sql: "SELECT COUNT(*) AS count FROM personal_expenses WHERE client_request_id = ?", args: [body.clientRequestId] });
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it("rejects categories owned by another account", async () => {
    const bCategories = await request(app).get("/api/spending/categories").set(auth(tokenB));
    const bCategoryId = bCategories.body.categories[0].id;
    const result = await expense({ amountCents: 1000, categoryId: bCategoryId, spentAt: "2026-08-03T09:00" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/belongs to your account/i);
  });

  it("archives and restores categories without destroying used references", async () => {
    const archived = await request(app).delete(`/api/spending/categories/${groceriesId}`).set(auth());
    expect(archived.status).toBe(204);
    const activeList = await request(app).get("/api/spending/categories").set(auth());
    expect(activeList.body.categories.some((category: { id: string }) => category.id === groceriesId)).toBe(false);

    const historical = await request(app).get("/api/spending/expenses?from=2026-08-03&to=2026-08-03").set(auth());
    expect(historical.body.expenses[0].category).toMatchObject({ id: groceriesId, name: "Groceries", archived: true });
    const row = await db.execute({ sql: "SELECT COUNT(*) AS count FROM spending_categories WHERE id = ?", args: [groceriesId] });
    expect(Number(row.rows[0].count)).toBe(1);

    const rejected = await expense({ amountCents: 1000, categoryId: groceriesId, spentAt: "2026-08-04T10:00" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/archived/i);

    const restored = await request(app).patch(`/api/spending/categories/${groceriesId}`).set(auth()).send({ archived: false });
    expect(restored.status).toBe(200);
    expect(restored.body.category.archived).toBe(false);
  });

  it("edits an expense and immediately returns the joined category", async () => {
    const result = await request(app).patch(`/api/spending/expenses/${expenseId}`).set(auth()).set("X-Client-Time-Zone", ZONE).send({
      amountCents: 5500, categoryId: transportId, spentAt: "2026-08-04T18:45", merchant: "Train", paymentMethod: "cash",
    });
    expect(result.status).toBe(200);
    expect(result.body.expense).toMatchObject({ amountCents: 5500, spentDate: "2026-08-04", merchant: "Train", category: { name: "Transport" } });
  });

  it("prevents cross-user expense reads, edits, and deletes", async () => {
    const list = await request(app).get("/api/spending/expenses").set(auth(tokenB));
    const edit = await request(app).patch(`/api/spending/expenses/${expenseId}`).set(auth(tokenB)).set("X-Client-Time-Zone", ZONE).send({ amountCents: 1 });
    const remove = await request(app).delete(`/api/spending/expenses/${expenseId}`).set(auth(tokenB));
    expect(list.body.expenses).toEqual([]);
    expect(edit.status).toBe(404);
    expect(remove.status).toBe(404);
  });

  it("supports date, category, merchant search, and pagination filters", async () => {
    for (let index = 0; index < 4; index++) {
      await expense({
        amountCents: 1000 + index,
        categoryId: groceriesId,
        spentAt: `2026-08-0${5 + index}T12:00`,
        merchant: index % 2 ? "Corner Cafe" : "Supermarket",
        clientRequestId: `22222222-2222-4222-8222-22222222222${index}`,
      });
    }
    const filtered = await request(app).get(`/api/spending/expenses?from=2026-08-05&to=2026-08-08&categoryId=${groceriesId}&search=cafe&page=1&pageSize=1`).set(auth());
    expect(filtered.status).toBe(200);
    expect(filtered.body.expenses).toHaveLength(1);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.hasMore).toBe(true);
    const page2 = await request(app).get(`/api/spending/expenses?from=2026-08-05&to=2026-08-08&categoryId=${groceriesId}&search=cafe&page=2&pageSize=1`).set(auth());
    expect(page2.body.expenses).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
  });

  it("calculates canonical earnings, week boundaries, spending, percentage, and previous-period comparison", async () => {
    await request(app).post("/api/shifts").set(auth()).send({ date: "2026-08-03", location: "Office", signIn: "09:00", signOut: "17:00" });
    await request(app).put("/api/day-expenses/2026-08-03").set(auth()).send({ fuelCost: 10 });
    await request(app).put("/api/week-extras/2026-08-03").set(auth()).send({ amount: 30, reason: "Bonus" });
    await expense({ amountCents: 10_000, categoryId: transportId, spentAt: "2026-07-30T10:00", clientRequestId: "33333333-3333-4333-8333-333333333333" });

    const summary = await request(app).get("/api/spending/summary?from=2026-08-03&to=2026-08-09").set(auth());
    expect(summary.status).toBe(200);
    expect(summary.body.period).toMatchObject({ from: "2026-08-03", to: "2026-08-09", previousFrom: "2026-07-27", previousTo: "2026-08-02", days: 7 });
    expect(summary.body.earningsCents).toBe(20_000); // 8h × $20 + $10 fuel + $30 extra
    expect(summary.body.totalSpendingCents).toBe(10_231); // edited Train + four fixtures + one concurrent-retry row
    expect(summary.body.differenceCents).toBe(9_769);
    expect(summary.body.spendingPercentage).toBe(51.2);
    expect(summary.body.previous.totalSpendingCents).toBe(10_000);
    expect(summary.body.previous.spendingChangePercent).toBe(2.3);
    expect(summary.body.categories.find((category: { name: string }) => category.name === "Groceries")).toMatchObject({ transactionCount: 5, totalCents: 4731 });
    expect(summary.body.trend[0].date).toBe("2026-08-03");
    expect(summary.body.recentExpenses.length).toBeLessThanOrEqual(5);
  });

  it("uses neutral zero-earnings semantics for a period without wage records", async () => {
    const summary = await request(app).get("/api/spending/summary?from=2026-06-01&to=2026-06-07").set(auth());
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ earningsCents: 0, earningsRecorded: false, spendingPercentage: null });
  });

  it("deletes an owned expense", async () => {
    const result = await request(app).delete(`/api/spending/expenses/${expenseId}`).set(auth());
    expect(result.status).toBe(204);
    const second = await request(app).delete(`/api/spending/expenses/${expenseId}`).set(auth());
    expect(second.status).toBe(404);
  });

  it("account deletion explicitly cascades personal expenses and custom/default categories", async () => {
    const password = "delete-spending-user-secure-2026";
    const signup = await request(app).post("/api/auth/signup").send({ name: "Delete Spending", email: "delete-spending@example.com", password, rate: 20 });
    const token = signup.body.token;
    const categories = await request(app).get("/api/spending/categories").set(auth(token));
    await expense({ amountCents: 1234, categoryId: categories.body.categories[0].id, spentAt: "2026-08-01T10:00" }, token);
    const deleted = await request(app).delete("/api/me").set(auth(token)).send({ password });
    expect(deleted.status).toBe(204);
    const userId = signup.body.user.id;
    const [expenseCount, categoryCount] = await Promise.all([
      db.execute({ sql: "SELECT COUNT(*) AS count FROM personal_expenses WHERE user_id = ?", args: [userId] }),
      db.execute({ sql: "SELECT COUNT(*) AS count FROM spending_categories WHERE user_id = ?", args: [userId] }),
    ]);
    expect(Number(expenseCount.rows[0].count)).toBe(0);
    expect(Number(categoryCount.rows[0].count)).toBe(0);
  });
});
