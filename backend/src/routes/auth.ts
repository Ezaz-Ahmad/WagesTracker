import bcrypt from "bcryptjs";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { signToken } from "../auth.js";
import { toPublicUser, type UserRow } from "../types.js";

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters").max(200),
  workLocationName: z.string().trim().max(200).optional().default(""),
  workAddress: z.string().trim().max(300).optional().default(""),
  multipleLocations: z.boolean().optional().default(false),
  otherLocations: z.string().trim().max(300).optional().default(""),
});

authRouter.post("/signup", (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    return;
  }
  const { name, email, password, workLocationName, workAddress, multipleLocations, otherLocations } = parsed.data;

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  const id = randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);
  const rate = 18.5;
  const goalHours = 35;
  const goalEarnings = Math.round(rate * goalHours * 100) / 100;

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, work_location_name, work_address, multiple_locations, other_locations, week_starts_on, rate, goal_hours, goal_earnings, created_at)
     VALUES (@id, @name, @email, @passwordHash, @workLocationName, @workAddress, @multipleLocations, @otherLocations, 'Monday', @rate, @goalHours, @goalEarnings, @createdAt)`
  ).run({
    id,
    name,
    email,
    passwordHash,
    workLocationName,
    workAddress,
    multipleLocations: multipleLocations ? 1 : 0,
    otherLocations,
    rate,
    goalHours,
    goalEarnings,
    createdAt: new Date().toISOString(),
  });

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  res.status(201).json({ token: signToken(id), user: toPublicUser(row) });
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }
  res.json({ token: signToken(row.id), user: toPublicUser(row) });
});
