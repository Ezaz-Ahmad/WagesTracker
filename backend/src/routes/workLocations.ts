import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { db } from "../db.js";
import { dollarsToCents, hasAtMostTwoDecimals, MAX_FUEL_ALLOWANCE } from "../fuelAllowances.js";
import { toPublicWorkLocation, type WorkLocationRow } from "../types.js";

export const workLocationsRouter = Router();
workLocationsRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const fuelAllowanceSchema = z
  .number()
  .positive("Fuel allowance must be greater than zero")
  .max(MAX_FUEL_ALLOWANCE, `Fuel allowance cannot exceed ${MAX_FUEL_ALLOWANCE}`)
  .refine(hasAtMostTwoDecimals, "Fuel allowance can have at most two decimal places")
  .nullable();

const createSchema = z.object({
  name: z.string().trim().min(1, "Location name is required").max(120),
  address: z.string().trim().max(300).optional().default(""),
  fuelAllowance: fuelAllowanceSchema.optional().default(null),
});

const patchSchema = z.object({
  name: z.string().trim().min(1, "Location name is required").max(120).optional(),
  address: z.string().trim().max(300).optional(),
  fuelAllowance: fuelAllowanceSchema.optional(),
  archived: z.boolean().optional(),
});

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint|sqlite_constraint|constraint failed/i.test(message);
}

workLocationsRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    const result = await db.execute({
      sql: `SELECT * FROM work_locations
            WHERE user_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"}
            ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE, created_at`,
      args: [req.userId!],
    });
    res.json({ locations: (result.rows as unknown as WorkLocationRow[]).map(toPublicWorkLocation) });
  })
);

workLocationsRouter.get(
  "/suggestions",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : "";
    if (!DATE_RE.test(weekStart) || Number.isNaN(Date.parse(`${weekStart}T00:00:00Z`))) {
      res.status(400).json({ error: "weekStart must be YYYY-MM-DD" });
      return;
    }
    const startMs = Date.parse(`${weekStart}T00:00:00Z`);
    const previousStart = new Date(startMs - 7 * 86_400_000).toISOString().slice(0, 10);
    const previousEnd = new Date(startMs - 86_400_000).toISOString().slice(0, 10);
    const result = await db.execute({
      sql: `SELECT s.date, s.work_location_id
            FROM shifts s
            JOIN work_locations wl ON wl.id = s.work_location_id AND wl.user_id = s.user_id
            WHERE s.user_id = ? AND s.date BETWEEN ? AND ?
              AND s.sign_in IS NOT NULL AND wl.archived_at IS NULL
            ORDER BY s.date, s.created_at, s.id`,
      args: [req.userId!, previousStart, previousEnd],
    });

    const suggestions: Record<string, string[]> = {};
    for (const row of result.rows) {
      const sourceDate = String(row.date);
      const targetDate = new Date(Date.parse(`${sourceDate}T00:00:00Z`) + 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      (suggestions[targetDate] ??= []).push(String(row.work_location_id));
    }
    res.json({ suggestions });
  })
);

workLocationsRouter.post(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const name = cleanName(parsed.data.name);
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await db.execute({
        sql: `INSERT INTO work_locations
              (id, user_id, name, normalized_name, address, fuel_allowance_cents, archived_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        args: [
          id,
          req.userId!,
          name,
          normalizeName(name),
          parsed.data.address,
          parsed.data.fuelAllowance == null ? null : dollarsToCents(parsed.data.fuelAllowance),
          now,
          now,
        ],
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        res.status(409).json({ error: "A work location with that name already exists" });
        return;
      }
      throw error;
    }
    const result = await db.execute({ sql: "SELECT * FROM work_locations WHERE id = ?", args: [id] });
    res.status(201).json({ location: toPublicWorkLocation(result.rows[0] as unknown as WorkLocationRow) });
  })
);

workLocationsRouter.patch(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const existing = await db.execute({
      sql: "SELECT id FROM work_locations WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Work location not found" });
      return;
    }

    const clauses: string[] = [];
    const args: Record<string, string | number | null> = {
      id: req.params.id,
      userId: req.userId!,
      updatedAt: new Date().toISOString(),
    };
    if (updates.name !== undefined) {
      const name = cleanName(updates.name);
      clauses.push("name = @name", "normalized_name = @normalizedName");
      args.name = name;
      args.normalizedName = normalizeName(name);
    }
    if (updates.address !== undefined) {
      clauses.push("address = @address");
      args.address = updates.address;
    }
    if (updates.fuelAllowance !== undefined) {
      clauses.push("fuel_allowance_cents = @fuelAllowanceCents");
      args.fuelAllowanceCents = updates.fuelAllowance == null ? null : dollarsToCents(updates.fuelAllowance);
    }
    if (updates.archived !== undefined) {
      clauses.push("archived_at = @archivedAt");
      args.archivedAt = updates.archived ? new Date().toISOString() : null;
    }
    clauses.push("updated_at = @updatedAt");

    try {
      await db.execute({
        sql: `UPDATE work_locations SET ${clauses.join(", ")} WHERE id = @id AND user_id = @userId`,
        args,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        res.status(409).json({ error: "A work location with that name already exists" });
        return;
      }
      throw error;
    }
    const result = await db.execute({ sql: "SELECT * FROM work_locations WHERE id = ?", args: [req.params.id] });
    res.json({ location: toPublicWorkLocation(result.rows[0] as unknown as WorkLocationRow) });
  })
);

workLocationsRouter.delete(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const now = new Date().toISOString();
    const result = await db.execute({
      sql: `UPDATE work_locations SET archived_at = ?, updated_at = ?
            WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
      args: [now, now, req.params.id, req.userId!],
    });
    if (result.rowsAffected === 0) {
      const exists = await db.execute({
        sql: "SELECT id FROM work_locations WHERE id = ? AND user_id = ?",
        args: [req.params.id, req.userId!],
      });
      if (exists.rows.length === 0) {
        res.status(404).json({ error: "Work location not found" });
        return;
      }
    }
    res.status(204).end();
  })
);
