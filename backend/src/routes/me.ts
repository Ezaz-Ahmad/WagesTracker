import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicUser, type UserRow } from "../types.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get("/", (req: AuthedRequest, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as UserRow | undefined;
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: toPublicUser(row) });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
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
  workLocationName: "work_location_name",
  workAddress: "work_address",
  multipleLocations: "multiple_locations",
  otherLocations: "other_locations",
  weekStartsOn: "week_starts_on",
  rate: "rate",
  goalHours: "goal_hours",
  goalEarnings: "goal_earnings",
};

meRouter.patch("/", (req: AuthedRequest, res) => {
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
  const params: Record<string, unknown> = { id: req.userId };
  for (const key of keys) {
    const column = FIELD_TO_COLUMN[key];
    let value: unknown = updates[key];
    if (key === "multipleLocations") value = value ? 1 : 0;
    setClauses.push(`${column} = @${key}`);
    params[key] = value;
  }

  db.prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = @id`).run(params);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as UserRow;
  res.json({ user: toPublicUser(row) });
});

const deleteSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

// Permanently deletes the account and every row that references it. Shifts cascade via the
// `ON DELETE CASCADE` foreign key (foreign_keys pragma is on in db.ts), so nothing is orphaned
// and nothing needs to be deleted manually here.
meRouter.delete("/", (req: AuthedRequest, res) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    return;
  }

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as UserRow | undefined;
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!bcrypt.compareSync(parsed.data.password, row.password_hash)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(req.userId);
  res.status(204).end();
});
