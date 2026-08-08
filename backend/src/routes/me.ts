import type { InValue } from "@libsql/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db.js";
import { requireAuth, signToken, type AuthedRequest } from "../auth.js";
import { hashPassword, verifyPassword } from "../security/passwordHashing.js";
import { validatePassword } from "../security/passwordPolicy.js";
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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  // Not .trim()'d, same reasoning as signup — see security/passwordPolicy.ts.
  newPassword: z.string().superRefine((value, ctx) => {
    const result = validatePassword(value);
    if (!result.valid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid password" });
    }
  }),
});

/**
 * Changes the signed-in user's password. Responds `204 No Content` per the
 * task's required contract, but a password change also has to invalidate
 * every other JWT issued for this account (see auth.ts's tokenVersion
 * check) — including the one the caller is using right now. Rather than
 * force a re-login for the request that just succeeded, the replacement
 * token is returned in the `X-New-Token` response header instead of a JSON
 * body, so the 204 stays a true empty-body response while the current
 * session can still pick it up and keep going. `app.ts` exposes this header
 * cross-origin via CORS `exposedHeaders` so the browser can actually read it.
 */
meRouter.patch(
  "/password",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;

    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    // Shouldn't happen for an authenticated request (requireAuth already
    // confirmed the account exists), but a generic 401 rather than a 404
    // avoids leaking anything about account state either way.
    if (!row) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    if (await verifyPassword(newPassword, row.password_hash)) {
      res.status(400).json({ error: "New password must be different from your current password" });
      return;
    }

    const newPasswordHash = await hashPassword(newPassword);
    const newTokenVersion = row.token_version + 1;
    // Single UPDATE — hash and token_version move together, so no other
    // request can ever observe the new hash paired with the old version (or
    // vice versa).
    await db.execute({
      sql: "UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?",
      args: [newPasswordHash, newTokenVersion, req.userId!],
    });

    const replacementToken = signToken(req.userId!, newTokenVersion);
    res.setHeader("X-New-Token", replacementToken);
    res.status(204).end();
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
    if (!(await verifyPassword(parsed.data.password, row.password_hash))) {
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
