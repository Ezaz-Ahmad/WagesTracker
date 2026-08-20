import { Router, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { db } from "../db.js";
import { earningsForRange } from "../earnings.js";
import {
  CLIENT_TIME_ZONE_HEADER,
  isSupportedIanaTimeZone,
  isValidDate,
  localDateForTimeZone,
  TIME_ZONE_REQUIRED_MESSAGE,
} from "../security/shiftRules.js";

export const spendingRouter = Router();
spendingRouter.use(requireAuth);

export const SPENDING_ICONS = [
  "dining", "groceries", "transport", "housing", "bills", "shopping",
  "health", "entertainment", "education", "family", "other",
] as const;

// Curated colours only: user input is stored as a palette token, never as
// arbitrary CSS/HTML. Each remains distinguishable in both app themes and is
// always paired with an icon and category name in the UI.
export const SPENDING_COLOURS = [
  "#B45309", "#047857", "#1D4ED8", "#7C3AED", "#0E7490", "#BE123C",
  "#9F1239", "#6D28D9", "#0369A1", "#A16207", "#475569",
] as const;

const DEFAULT_CATEGORIES = [
  ["food-dining", "Food & dining", "dining", "#B45309"],
  ["groceries", "Groceries", "groceries", "#047857"],
  ["transport", "Transport", "transport", "#1D4ED8"],
  ["rent-housing", "Rent & housing", "housing", "#7C3AED"],
  ["bills-utilities", "Bills & utilities", "bills", "#0E7490"],
  ["shopping", "Shopping", "shopping", "#BE123C"],
  ["health", "Health", "health", "#9F1239"],
  ["entertainment", "Entertainment", "entertainment", "#6D28D9"],
  ["education", "Education", "education", "#0369A1"],
  ["family", "Family", "family", "#A16207"],
  ["other", "Other", "other", "#475569"],
] as const;

interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  colour: string;
  is_default: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExpenseRow {
  id: string;
  amount_cents: number;
  category_id: string;
  spent_at: string;
  spent_date: string;
  time_zone: string;
  merchant: string;
  note: string;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
  category_name: string;
  category_icon: string;
  category_colour: string;
  category_archived_at: string | null;
}

function publicCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    colour: row.colour,
    isDefault: !!row.is_default,
    archived: row.archived_at !== null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicExpense(row: ExpenseRow) {
  return {
    id: row.id,
    amountCents: Number(row.amount_cents),
    categoryId: row.category_id,
    spentAt: row.spent_at,
    spentDate: row.spent_date,
    timeZone: row.time_zone,
    merchant: row.merchant,
    note: row.note,
    paymentMethod: row.payment_method,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    category: {
      id: row.category_id,
      name: row.category_name,
      icon: row.category_icon,
      colour: row.category_colour,
      archived: row.category_archived_at !== null,
    },
  };
}

export async function ensureDefaultSpendingCategories(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.batch(
    DEFAULT_CATEGORIES.map(([seedKey, name, icon, colour]) => ({
      sql: `INSERT INTO spending_categories
              (id, user_id, name, icon, colour, is_default, seed_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(user_id, seed_key) DO NOTHING`,
      args: [randomUUID(), userId, name, icon, colour, seedKey, now, now],
    })),
    "write"
  );
}

function validationError(res: Response, message: string, code?: string): void {
  res.status(400).json({ error: message, ...(code ? { code } : {}) });
}

function requestTimeZone(req: AuthedRequest, res: Response): string | null {
  const raw = req.get(CLIENT_TIME_ZONE_HEADER) ?? "";
  if (!isSupportedIanaTimeZone(raw)) {
    validationError(res, TIME_ZONE_REQUIRED_MESSAGE, "INVALID_CLIENT_TIME_ZONE");
    return null;
  }
  return raw.trim();
}

function categoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const categoryCreateSchema = z.object({
  name: z.string().min(1).max(50).transform(categoryName),
  icon: z.enum(SPENDING_ICONS),
  colour: z.enum(SPENDING_COLOURS),
});

const categoryPatchSchema = z.object({
  name: z.string().min(1).max(50).transform(categoryName).optional(),
  icon: z.enum(SPENDING_ICONS).optional(),
  colour: z.enum(SPENDING_COLOURS).optional(),
  archived: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required");

async function activeNameExists(userId: string, name: string, exceptId?: string): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT 1 FROM spending_categories
          WHERE user_id = ? AND lower(name) = lower(?) AND archived_at IS NULL${exceptId ? " AND id <> ?" : ""}
          LIMIT 1`,
    args: exceptId ? [userId, name, exceptId] : [userId, name],
  });
  return result.rows.length > 0;
}

spendingRouter.get(
  "/categories",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await ensureDefaultSpendingCategories(req.userId!);
    const includeArchived = req.query.includeArchived === "true";
    const result = await db.execute({
      sql: `SELECT * FROM spending_categories WHERE user_id = ?${includeArchived ? "" : " AND archived_at IS NULL"}
            ORDER BY archived_at IS NOT NULL, is_default DESC, name COLLATE NOCASE`,
      args: [req.userId!],
    });
    res.json({ categories: (result.rows as unknown as CategoryRow[]).map(publicCategory) });
  })
);

spendingRouter.post(
  "/categories",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = categoryCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message || "Invalid category");
    await ensureDefaultSpendingCategories(req.userId!);
    if (await activeNameExists(req.userId!, parsed.data.name)) {
      res.status(409).json({ error: "You already have an active category with that name." });
      return;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO spending_categories
              (id, user_id, name, icon, colour, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      args: [id, req.userId!, parsed.data.name, parsed.data.icon, parsed.data.colour, now, now],
    });
    const result = await db.execute({ sql: "SELECT * FROM spending_categories WHERE id = ? AND user_id = ?", args: [id, req.userId!] });
    res.status(201).json({ category: publicCategory(result.rows[0] as unknown as CategoryRow) });
  })
);

spendingRouter.patch(
  "/categories/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = categoryPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message || "Invalid category update");
    const currentResult = await db.execute({
      sql: "SELECT * FROM spending_categories WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    if (!currentResult.rows[0]) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    const current = currentResult.rows[0] as unknown as CategoryRow;
    const nextName = parsed.data.name ?? current.name;
    const restoring = parsed.data.archived === false && current.archived_at !== null;
    const activeAfter = parsed.data.archived === true ? false : current.archived_at === null || restoring;
    if (activeAfter && await activeNameExists(req.userId!, nextName, current.id)) {
      res.status(409).json({ error: "You already have an active category with that name." });
      return;
    }
    const now = new Date().toISOString();
    const archivedAt = parsed.data.archived === true ? current.archived_at ?? now : parsed.data.archived === false ? null : current.archived_at;
    await db.execute({
      sql: `UPDATE spending_categories SET name = ?, icon = ?, colour = ?, archived_at = ?, updated_at = ?
            WHERE id = ? AND user_id = ?`,
      args: [nextName, parsed.data.icon ?? current.icon, parsed.data.colour ?? current.colour, archivedAt, now, current.id, req.userId!],
    });
    const result = await db.execute({ sql: "SELECT * FROM spending_categories WHERE id = ? AND user_id = ?", args: [current.id, req.userId!] });
    res.json({ category: publicCategory(result.rows[0] as unknown as CategoryRow) });
  })
);

spendingRouter.delete(
  "/categories/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const result = await db.execute({
      sql: "SELECT archived_at FROM spending_categories WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    if (!result.rows[0]) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    const now = new Date().toISOString();
    await db.execute({
      sql: "UPDATE spending_categories SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ? AND user_id = ?",
      args: [now, now, req.params.id, req.userId!],
    });
    res.status(204).end();
  })
);

const LOCAL_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d$/;
const expenseWriteSchema = z.object({
  amountCents: z.number().int().min(1, "Amount must be greater than zero.").max(100_000_000, "Amount is too large."),
  categoryId: z.string().uuid("Choose a valid category."),
  spentAt: z.string().regex(LOCAL_DATE_TIME_RE, "Choose a valid date and time."),
  merchant: z.string().trim().max(100, "Merchant or title must be 100 characters or fewer.").optional().default(""),
  note: z.string().trim().max(500, "Note must be 500 characters or fewer.").optional().default(""),
  paymentMethod: z.enum(["card", "cash", "bank_transfer", "other"]).nullable().optional().default(null),
  clientRequestId: z.string().uuid().optional(),
});

const expensePatchSchema = expenseWriteSchema.omit({ clientRequestId: true }).partial()
  .refine((value) => Object.keys(value).length > 0, "At least one change is required");

function validateSpentAt(spentAt: string, timeZone: string): string | null {
  const match = LOCAL_DATE_TIME_RE.exec(spentAt);
  const date = match?.[1] ?? "";
  if (!isValidDate(date)) return "Choose a real calendar date.";
  if (date > localDateForTimeZone(new Date(), timeZone)) return "You can't record spending for a future date.";
  return null;
}

async function ownedCategory(userId: string, categoryId: string): Promise<CategoryRow | null> {
  const result = await db.execute({
    sql: "SELECT * FROM spending_categories WHERE id = ? AND user_id = ?",
    args: [categoryId, userId],
  });
  return (result.rows[0] as unknown as CategoryRow | undefined) ?? null;
}

const EXPENSE_SELECT = `SELECT p.*, c.name AS category_name, c.icon AS category_icon,
  c.colour AS category_colour, c.archived_at AS category_archived_at
  FROM personal_expenses p JOIN spending_categories c ON c.id = p.category_id`;

async function selectExpense(userId: string, id: string): Promise<ExpenseRow | null> {
  const result = await db.execute({ sql: `${EXPENSE_SELECT} WHERE p.id = ? AND p.user_id = ?`, args: [id, userId] });
  return (result.rows[0] as unknown as ExpenseRow | undefined) ?? null;
}

spendingRouter.get(
  "/expenses",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await ensureDefaultSpendingCategories(req.userId!);
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) {
      return validationError(res, "Choose a valid date range.");
    }
    const clauses = ["p.user_id = ?"];
    const args: (string | number)[] = [req.userId!];
    if (from) { clauses.push("p.spent_date >= ?"); args.push(from); }
    if (to) { clauses.push("p.spent_date <= ?"); args.push(to); }
    if (typeof req.query.categoryId === "string" && req.query.categoryId) {
      clauses.push("p.category_id = ?"); args.push(req.query.categoryId);
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      clauses.push("lower(p.merchant) LIKE ? ESCAPE '\\'");
      const escaped = req.query.search.trim().toLowerCase().replace(/[\\%_]/g, "\\$&");
      args.push(`%${escaped}%`);
    }
    const where = clauses.join(" AND ");
    const [rowsResult, countResult] = await Promise.all([
      db.execute({
        sql: `${EXPENSE_SELECT} WHERE ${where} ORDER BY p.spent_at DESC, p.id DESC LIMIT ? OFFSET ?`,
        args: [...args, pageSize, (page - 1) * pageSize],
      }),
      db.execute({ sql: `SELECT COUNT(*) AS total FROM personal_expenses p WHERE ${where}`, args }),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    res.json({
      expenses: (rowsResult.rows as unknown as ExpenseRow[]).map(publicExpense),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    });
  })
);

spendingRouter.post(
  "/expenses",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const timeZone = requestTimeZone(req, res);
    if (!timeZone) return;
    const parsed = expenseWriteSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message || "Invalid expense");
    const dateError = validateSpentAt(parsed.data.spentAt, timeZone);
    if (dateError) return validationError(res, dateError);
    await ensureDefaultSpendingCategories(req.userId!);
    const category = await ownedCategory(req.userId!, parsed.data.categoryId);
    if (!category) return validationError(res, "Choose a category that belongs to your account.");
    if (category.archived_at) return validationError(res, "That category is archived. Choose an active category.");

    if (parsed.data.clientRequestId) {
      const existing = await db.execute({
        sql: "SELECT id FROM personal_expenses WHERE user_id = ? AND client_request_id = ?",
        args: [req.userId!, parsed.data.clientRequestId],
      });
      if (existing.rows[0]) {
        const row = await selectExpense(req.userId!, String(existing.rows[0].id));
        res.json({ expense: publicExpense(row!) });
        return;
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await db.execute({
        sql: `INSERT INTO personal_expenses
                (id, user_id, category_id, amount_cents, spent_at, spent_date, time_zone,
                 merchant, note, payment_method, client_request_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, req.userId!, parsed.data.categoryId, parsed.data.amountCents, parsed.data.spentAt,
          parsed.data.spentAt.slice(0, 10), timeZone, parsed.data.merchant, parsed.data.note,
          parsed.data.paymentMethod, parsed.data.clientRequestId ?? null, now, now],
      });
    } catch (error) {
      // Two requests carrying the same retry UUID can race past the lookup
      // above. The database constraint chooses one winner; the loser returns
      // that winner instead of leaking a uniqueness error or inserting a
      // second purchase. Do not log the failed SQL/args: merchant/note data is
      // sensitive and must not enter application logs.
      if (parsed.data.clientRequestId) {
        const existing = await db.execute({
          sql: "SELECT id FROM personal_expenses WHERE user_id = ? AND client_request_id = ?",
          args: [req.userId!, parsed.data.clientRequestId],
        });
        if (existing.rows[0]) {
          const duplicate = await selectExpense(req.userId!, String(existing.rows[0].id));
          res.json({ expense: publicExpense(duplicate!) });
          return;
        }
      }
      throw error;
    }
    const row = await selectExpense(req.userId!, id);
    res.status(201).json({ expense: publicExpense(row!) });
  })
);

spendingRouter.patch(
  "/expenses/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const timeZone = requestTimeZone(req, res);
    if (!timeZone) return;
    const parsed = expensePatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message || "Invalid expense update");
    const current = await selectExpense(req.userId!, req.params.id);
    if (!current) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }
    const spentAt = parsed.data.spentAt ?? current.spent_at;
    const dateError = validateSpentAt(spentAt, timeZone);
    if (dateError) return validationError(res, dateError);
    const categoryId = parsed.data.categoryId ?? current.category_id;
    const category = await ownedCategory(req.userId!, categoryId);
    if (!category) return validationError(res, "Choose a category that belongs to your account.");
    if (category.archived_at && categoryId !== current.category_id) {
      return validationError(res, "That category is archived. Choose an active category.");
    }
    const now = new Date().toISOString();
    await db.execute({
      sql: `UPDATE personal_expenses SET category_id = ?, amount_cents = ?, spent_at = ?, spent_date = ?,
              time_zone = ?, merchant = ?, note = ?, payment_method = ?, updated_at = ?
            WHERE id = ? AND user_id = ?`,
      args: [categoryId, parsed.data.amountCents ?? current.amount_cents, spentAt, spentAt.slice(0, 10),
        parsed.data.spentAt ? timeZone : current.time_zone, parsed.data.merchant ?? current.merchant,
        parsed.data.note ?? current.note, parsed.data.paymentMethod === undefined ? current.payment_method : parsed.data.paymentMethod,
        now, current.id, req.userId!],
    });
    const row = await selectExpense(req.userId!, current.id);
    res.json({ expense: publicExpense(row!) });
  })
);

spendingRouter.delete(
  "/expenses/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const result = await db.execute({
      sql: "DELETE FROM personal_expenses WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    if (result.rowsAffected === 0) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }
    res.status(204).end();
  })
);

function addUtcDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

async function spendingTotal(userId: string, from: string, to: string): Promise<number> {
  const result = await db.execute({
    sql: "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM personal_expenses WHERE user_id = ? AND spent_date >= ? AND spent_date <= ?",
    args: [userId, from, to],
  });
  return Number(result.rows[0]?.total ?? 0);
}

spendingRouter.get(
  "/summary",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!isValidDate(from) || !isValidDate(to) || from > to || inclusiveDays(from, to) > 3660) {
      return validationError(res, "Choose a valid date range of 10 years or less.");
    }
    await ensureDefaultSpendingCategories(req.userId!);
    const days = inclusiveDays(from, to);
    const previousTo = addUtcDays(from, -1);
    const previousFrom = addUtcDays(previousTo, -(days - 1));
    const [totalCents, previousTotalCents, earnings, previousEarnings, countResult, categoryResult, trendResult, recentResult] = await Promise.all([
      spendingTotal(req.userId!, from, to),
      spendingTotal(req.userId!, previousFrom, previousTo),
      earningsForRange(db, req.userId!, from, to),
      earningsForRange(db, req.userId!, previousFrom, previousTo),
      db.execute({
        sql: "SELECT COUNT(*) AS count FROM personal_expenses WHERE user_id = ? AND spent_date >= ? AND spent_date <= ?",
        args: [req.userId!, from, to],
      }),
      db.execute({
        sql: `SELECT c.id, c.name, c.icon, c.colour, SUM(p.amount_cents) AS total_cents, COUNT(*) AS transaction_count
              FROM personal_expenses p JOIN spending_categories c ON c.id = p.category_id
              WHERE p.user_id = ? AND p.spent_date >= ? AND p.spent_date <= ?
              GROUP BY c.id, c.name, c.icon, c.colour ORDER BY total_cents DESC, c.name COLLATE NOCASE`,
        args: [req.userId!, from, to],
      }),
      db.execute({
        sql: `SELECT spent_date AS date, SUM(amount_cents) AS total_cents
              FROM personal_expenses WHERE user_id = ? AND spent_date >= ? AND spent_date <= ?
              GROUP BY spent_date ORDER BY spent_date`,
        args: [req.userId!, from, to],
      }),
      db.execute({
        sql: `${EXPENSE_SELECT} WHERE p.user_id = ? AND p.spent_date >= ? AND p.spent_date <= ?
              ORDER BY p.spent_at DESC, p.id DESC LIMIT 5`,
        args: [req.userId!, from, to],
      }),
    ]);
    const categories = categoryResult.rows.map((row) => ({
      id: String(row.id), name: String(row.name), icon: String(row.icon), colour: String(row.colour),
      totalCents: Number(row.total_cents), transactionCount: Number(row.transaction_count),
    }));
    const spendingChangePercent = previousTotalCents > 0
      ? Math.round(((totalCents - previousTotalCents) / previousTotalCents) * 1000) / 10
      : totalCents === 0 ? 0 : null;
    res.json({
      period: { from, to, previousFrom, previousTo, days },
      earningsCents: earnings.earningsCents,
      earningsRecorded: earnings.hasRecords,
      totalSpendingCents: totalCents,
      differenceCents: earnings.earningsCents - totalCents,
      spendingPercentage: earnings.earningsCents > 0 ? Math.round((totalCents / earnings.earningsCents) * 1000) / 10 : null,
      averageDailyCents: Math.round(totalCents / days),
      transactionCount: Number(countResult.rows[0]?.count ?? 0),
      largestCategory: categories[0] ?? null,
      previous: {
        earningsCents: previousEarnings.earningsCents,
        totalSpendingCents: previousTotalCents,
        spendingChangePercent,
      },
      categories,
      trend: trendResult.rows.map((row) => ({ date: String(row.date), totalCents: Number(row.total_cents) })),
      recentExpenses: (recentResult.rows as unknown as ExpenseRow[]).map(publicExpense),
    });
  })
);
