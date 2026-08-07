import bcrypt from "bcryptjs";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db.js";
import { signToken } from "../auth.js";
import { toPublicUser, type UserRow } from "../types.js";

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters").max(200),
  address: z.string().trim().max(300).optional().default(""),
  workLocationName: z.string().trim().max(200).optional().default(""),
  workAddress: z.string().trim().max(300).optional().default(""),
  multipleLocations: z.boolean().optional().default(false),
  otherLocations: z.string().trim().max(300).optional().default(""),
  // Optional so old clients (or a signup call that omits it) still work —
  // falls back to the same 18.50 default the app used before this was
  // exposed on the signup form, rather than rejecting the request.
  rate: z.coerce.number().min(0).max(1000).optional(),
});

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { name, email, password, address, workLocationName, workAddress, multipleLocations, otherLocations, rate: rateInput } =
      parsed.data;

    const existing = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const id = randomUUID();
    const passwordHash = bcrypt.hashSync(password, 10);
    const rate = rateInput ?? 18.5;
    const goalHours = 35;
    const goalEarnings = Math.round(rate * goalHours * 100) / 100;

    await db.execute({
      sql: `INSERT INTO users (id, name, email, password_hash, address, work_location_name, work_address, multiple_locations, other_locations, week_starts_on, rate, goal_hours, goal_earnings, created_at)
            VALUES (@id, @name, @email, @passwordHash, @address, @workLocationName, @workAddress, @multipleLocations, @otherLocations, 'Monday', @rate, @goalHours, @goalEarnings, @createdAt)`,
      args: {
        id,
        name,
        email,
        passwordHash,
        address,
        workLocationName,
        workAddress,
        multipleLocations: multipleLocations ? 1 : 0,
        otherLocations,
        rate,
        goalHours,
        goalEarnings,
        createdAt: new Date().toISOString(),
      },
    });

    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
    const row = result.rows[0] as unknown as UserRow;
    res.status(201).json({ token: signToken(id), user: toPublicUser(row) });
  })
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { email, password } = parsed.data;
    const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      res.status(401).json({ error: "Incorrect email or password" });
      return;
    }
    res.json({ token: signToken(row.id), user: toPublicUser(row) });
  })
);
