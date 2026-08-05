import type { InValue } from "@libsql/client";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db, pruneExpiredShifts } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicShift, type ShiftRow } from "../types.js";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Accepts "HH:MM" (manual entry) and "HH:MM:SS" (the sign-in/out buttons capture
// seconds so short shifts can be rounded fairly instead of truncated to zero).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

shiftsRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await pruneExpiredShifts();
    const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : null;

    let query = "SELECT * FROM shifts WHERE user_id = ?";
    const params: unknown[] = [req.userId!];
    if (from) {
      query += " AND date >= ?";
      params.push(from);
    }
    if (to) {
      query += " AND date <= ?";
      params.push(to);
    }
    query += " ORDER BY date ASC, created_at ASC";

    const result = await db.execute({ sql: query, args: params as (string | number)[] });
    const rows = result.rows as unknown as ShiftRow[];
    res.json({ shifts: rows.map(toPublicShift) });
  })
);

const createSchema = z.object({
  date: z.string().regex(DATE_RE, "date must be YYYY-MM-DD"),
  location: z.string().trim().max(200).optional().default(""),
  signIn: z.string().regex(TIME_RE).nullable().optional().default(null),
  signOut: z.string().regex(TIME_RE).nullable().optional().default(null),
});

shiftsRouter.post(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { date, location, signIn, signOut } = parsed.data;
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO shifts (id, user_id, date, location, sign_in, sign_out, created_at, updated_at)
            VALUES (@id, @userId, @date, @location, @signIn, @signOut, @now, @now)`,
      args: { id, userId: req.userId!, date, location, signIn, signOut, now },
    });

    const result = await db.execute({ sql: "SELECT * FROM shifts WHERE id = ?", args: [id] });
    const row = result.rows[0] as unknown as ShiftRow;
    res.status(201).json({ shift: toPublicShift(row) });
  })
);

const patchSchema = z.object({
  location: z.string().trim().max(200).optional(),
  signIn: z.string().regex(TIME_RE).nullable().optional(),
  signOut: z.string().regex(TIME_RE).nullable().optional(),
});

shiftsRouter.patch(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const existingResult = await db.execute({
      sql: "SELECT * FROM shifts WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    const existing = existingResult.rows[0] as unknown as ShiftRow | undefined;
    if (!existing) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }

    const updates = parsed.data;
    const keys = Object.keys(updates) as (keyof typeof updates)[];
    if (keys.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const columnFor: Record<string, string> = { location: "location", signIn: "sign_in", signOut: "sign_out" };
    const setClauses = keys.map((k) => `${columnFor[k]} = @${k}`);
    const params: Record<string, InValue> = { id: req.params.id, updatedAt: new Date().toISOString() };
    for (const k of keys) params[k] = updates[k] as InValue;

    await db.execute({ sql: `UPDATE shifts SET ${setClauses.join(", ")}, updated_at = @updatedAt WHERE id = @id`, args: params });
    const result = await db.execute({ sql: "SELECT * FROM shifts WHERE id = ?", args: [req.params.id] });
    const row = result.rows[0] as unknown as ShiftRow;
    res.json({ shift: toPublicShift(row) });
  })
);

shiftsRouter.delete(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const result = await db.execute({
      sql: "DELETE FROM shifts WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    if (result.rowsAffected === 0) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }
    res.status(204).end();
  })
);
