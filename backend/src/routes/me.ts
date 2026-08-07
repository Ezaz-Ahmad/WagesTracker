import type { InValue } from "@libsql/client";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicUser, type UserRow } from "../types.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: toPublicUser(row) });
  })
);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(300).optional(),
  workLocationName: z.string().trim().max(200).optional(),
  workAddress: z.string().trim().max(300).optional(),
  multipleLocations: z.boolean().optional(),
  otherLocations: z.string().trim().max(300).optional(),
  weekStartsOn: z.enum(["Monday", "Sunday"]).optional(),
  rate: z.number().min(0).max(1000).optional(),
  goalHours: z.number().min(0).max(200).optional(),
  goalEarnings: z.number().min(0).max(100000).optional(),
});

const FIELD_TO_COLUMN: Record<string, string> = {
  name: "name",
  address: "address",
  workLocationName: "work_location_name",
  workAddress: "work_address",
  multipleLocations: "multiple_locations",
  otherLocations: "other_locations",
  weekStartsOn: "week_starts_on",
  rate: "rate",
  goalHours: "goal_hours",
  goalEarnings: "goal_earnings",
};

meRouter.patch(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const updates = parsed.data;
    const keys = Object.keys(updates) as (keyof typeof updates)[];
    if (keys.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const setClauses: string[] = [];
    const params: Record<string, InValue> = { id: req.userId! };
    for (const key of keys) {
      const column = FIELD_TO_COLUMN[key];
      let value: InValue = updates[key] as InValue;
      if (key === "multipleLocations") value = value ? 1 : 0;
      setClauses.push(`${column} = @${key}`);
      params[key] = value;
    }

    await db.execute({ sql: `UPDATE users SET ${setClauses.join(", ")} WHERE id = @id`, args: params });
    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
    const row = result.rows[0] as unknown as UserRow;
    res.json({ user: toPublicUser(row) });
  })
);

const deleteSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

// Permanently deletes the account and every row that references it. Every referencing
// table is deleted explicitly (not just relying on ON DELETE CASCADE) as a safety net:
// foreign-key enforcement on a remote libSQL/Turso connection isn't guaranteed to behave
// identically to local SQLite, so this doesn't assume the cascade fires. Covered by
// backend/test/account-deletion.test.ts, which asserts all four tables end up empty.
meRouter.delete(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }

    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!bcrypt.compareSync(parsed.data.password, row.password_hash)) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }

    await db.batch(
      [
        { sql: "DELETE FROM shifts WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM day_expenses WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM week_extras WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM users WHERE id = ?", args: [req.userId!] },
      ],
      "write"
    );
    res.status(204).end();
  })
);
