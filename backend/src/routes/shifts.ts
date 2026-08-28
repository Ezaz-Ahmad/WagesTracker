import type { InValue } from "@libsql/client";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db, pruneExpiredShifts } from "../db.js";
import { recalculateDayFuelAllowance } from "../fuelAllowances.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicShift, type ShiftRow, type WorkLocationRow } from "../types.js";
import {
  FUTURE_DATE_MESSAGE,
  CLIENT_TIME_ZONE_HEADER,
  OVERLAP_MESSAGE,
  TIME_ZONE_REQUIRED_MESSAGE,
  ZERO_LENGTH_MESSAGE as SHARED_ZERO_LENGTH_MESSAGE,
  findOverlap,
  isSupportedIanaTimeZone,
  localDateForTimeZone,
  validateShiftTimes,
} from "../security/shiftRules.js";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Accepts "HH:MM" (manual entry) and "HH:MM:SS" (the sign-in/out buttons capture
// seconds so short shifts can be rounded fairly instead of truncated to zero).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Overnight shifts ARE supported — a sign-out earlier than sign-in (e.g.
// 10:00 PM -> 6:00 AM) is read as crossing midnight into the next calendar
// day, not rejected. The only combination that's actually invalid is an
// identical sign-in/sign-out: that's a zero-length shift, not a 24-hour one,
// so it's rejected rather than silently saved as 0 hours. See computeHours
// in frontend/src/lib/date.ts for the matching duration math, and the note
// below on which calendar date an overnight shift's hours belong to.
function isNonZeroDuration(signIn: string, signOut: string): boolean {
  return signOut !== signIn;
}
const ZERO_LENGTH_MESSAGE = SHARED_ZERO_LENGTH_MESSAGE;

function requestLocalDate(req: AuthedRequest): string | null {
  const raw = req.get(CLIENT_TIME_ZONE_HEADER);
  if (!raw || !isSupportedIanaTimeZone(raw)) return null;
  // The instant comes from the backend clock. The browser supplies only the
  // rules used to view that instant as a local calendar date.
  return localDateForTimeZone(new Date(), raw.trim());
}

/**
 * Loads the caller's other complete shifts near `date`, for the overlap
 * check. One day either side is sufficient and necessary: an overnight shift
 * is filed under its starting day and remains under 24 hours, so a shift on
 * day D-1 can reach into D, and one on D can reach
 * into D+1 — nothing further out can touch D at all.
 */
async function neighbouringShifts(
  userId: string,
  date: string,
  excludeId?: string
): Promise<{ id: string; date: string; signIn: string | null; signOut: string | null }[]> {
  const day = Date.parse(`${date}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const sql = excludeId
    ? "SELECT id, date, sign_in, sign_out FROM shifts WHERE user_id = ? AND date BETWEEN ? AND ? AND id != ?"
    : "SELECT id, date, sign_in, sign_out FROM shifts WHERE user_id = ? AND date BETWEEN ? AND ?";
  const args = excludeId
    ? [userId, iso(day - 86_400_000), iso(day + 86_400_000), excludeId]
    : [userId, iso(day - 86_400_000), iso(day + 86_400_000)];
  const result = await db.execute({ sql, args });
  return (result.rows as unknown as ShiftRow[]).map((r) => ({
    id: r.id,
    date: r.date,
    signIn: r.sign_in,
    signOut: r.sign_out,
  }));
}

// A shift is "open" — signed in, not yet signed out — for exactly as long
// as it's still in progress. At most one of these should ever exist per
// user; without enforcing that, two tabs or devices (or a slow retry after
// a dropped response) could each create their own open shift, and the
// frontend's "one active shift" model (see useTodayShift.ts) would have no
// well-defined shift to actually act on.
const OPEN_SHIFT_CONFLICT_MESSAGE = "You already have an open shift. Sign out of it before starting another.";

async function hasOpenShift(userId: string, excludeId?: string): Promise<boolean> {
  const sql = excludeId
    ? "SELECT 1 FROM shifts WHERE user_id = ? AND sign_in IS NOT NULL AND sign_out IS NULL AND id != ? LIMIT 1"
    : "SELECT 1 FROM shifts WHERE user_id = ? AND sign_in IS NOT NULL AND sign_out IS NULL LIMIT 1";
  const args = excludeId ? [userId, excludeId] : [userId];
  const result = await db.execute({ sql, args });
  return result.rows.length > 0;
}

// The partial unique index in db.ts (idx_shifts_one_open_per_user) is what
// actually stops a race between two near-simultaneous requests — the
// hasOpenShift() check above this can't, since both could read "no open
// shift" before either has committed. This is what turns that index's raw
// constraint-violation error into the same clean 409 response the upfront
// check produces in the non-race case, rather than a generic 500.
function isUniqueConstraintError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /unique constraint|sqlite_constraint|constraint failed/i.test(message);
}

async function findActiveWorkLocation(
  userId: string,
  workLocationId: string | null | undefined,
  legacyName?: string
): Promise<WorkLocationRow | null> {
  if (workLocationId) {
    const result = await db.execute({
      sql: "SELECT * FROM work_locations WHERE id = ? AND user_id = ? AND archived_at IS NULL",
      args: [workLocationId, userId],
    });
    return (result.rows[0] as unknown as WorkLocationRow | undefined) ?? null;
  }
  const normalized = legacyName?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
  if (!normalized) return null;
  const result = await db.execute({
    sql: "SELECT * FROM work_locations WHERE user_id = ? AND normalized_name = ? AND archived_at IS NULL",
    args: [userId, normalized],
  });
  return (result.rows[0] as unknown as WorkLocationRow | undefined) ?? null;
}

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

// `date` is the day this shift is filed under — for an overnight shift,
// that's always the *starting* day (when sign-in happened), never the day
// sign-out lands on. There's no separate end-date field: the client sends
// one `date` for the whole shift, and every screen/report that groups by
// day (Entry's accordion, Home's week-at-a-glance, weekly/monthly/yearly
// totals in aggregate.ts) attributes 100% of an overnight shift's hours to
// that one date, none of it carried over onto the next calendar day's row.
const createSchema = z
  .object({
    date: z.string().regex(DATE_RE, "date must be YYYY-MM-DD"),
    location: z.string().trim().max(200).optional().default(""),
    workLocationId: z.string().uuid("Invalid work location").nullable().optional().default(null),
    signIn: z.string().regex(TIME_RE).nullable().optional().default(null),
    signOut: z.string().regex(TIME_RE).nullable().optional().default(null),
  })
  .refine((data) => !data.signIn || !data.signOut || isNonZeroDuration(data.signIn, data.signOut), {
    message: ZERO_LENGTH_MESSAGE,
    path: ["signOut"],
  });

shiftsRouter.post(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const localToday = requestLocalDate(req);
    if (!localToday) {
      res.status(400).json({ error: TIME_ZONE_REQUIRED_MESSAGE, code: "INVALID_CLIENT_TIME_ZONE" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { date, location, workLocationId, signIn, signOut } = parsed.data;

    const selectedLocation = await findActiveWorkLocation(req.userId!, workLocationId, location);
    if (workLocationId && !selectedLocation) {
      res.status(400).json({ error: "Select an active work location" });
      return;
    }
    const locationSnapshot = selectedLocation?.name ?? location;
    const selectedLocationId = selectedLocation?.id ?? null;
    const allowanceSnapshotCents = selectedLocation?.fuel_allowance_cents ?? null;

    // Real-calendar-date, future-date and zero-duration checks. Applied
    // to every create, not just historical ones — see security/shiftRules.ts.
    const problem = validateShiftTimes({ date, signIn, signOut }, localToday);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }

    // Only a shift that would itself be "open" needs this check — a
    // complete shift (both times set, or neither) can never conflict with
    // an already-open one.
    if (signIn && !signOut && (await hasOpenShift(req.userId!))) {
      res.status(409).json({ error: OPEN_SHIFT_CONFLICT_MESSAGE });
      return;
    }

    // 409 rather than 400: the shift itself is well-formed, it conflicts
    // with existing state — the same distinction the open-shift rule draws.
    if (findOverlap({ date, signIn, signOut }, await neighbouringShifts(req.userId!, date))) {
      res.status(409).json({ error: OVERLAP_MESSAGE });
      return;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const transaction = await db.transaction("write");
    try {
      await transaction.execute({
        sql: `INSERT INTO shifts
              (id, user_id, date, location, work_location_id, location_snapshot,
               fuel_allowance_snapshot_cents, sign_in, sign_out, created_at, updated_at)
              VALUES (@id, @userId, @date, @location, @workLocationId, @locationSnapshot,
                      @allowanceSnapshotCents, @signIn, @signOut, @now, @now)`,
        args: {
          id,
          userId: req.userId!,
          date,
          location: locationSnapshot,
          workLocationId: selectedLocationId,
          locationSnapshot,
          allowanceSnapshotCents,
          signIn,
          signOut,
          now,
        },
      });
      await recalculateDayFuelAllowance(transaction, req.userId!, date);
      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      if (isUniqueConstraintError(e)) {
        res.status(409).json({ error: OPEN_SHIFT_CONFLICT_MESSAGE });
        return;
      }
      throw e;
    } finally {
      transaction.close();
    }

    const result = await db.execute({ sql: "SELECT * FROM shifts WHERE id = ?", args: [id] });
    const row = result.rows[0] as unknown as ShiftRow;
    res.status(201).json({ shift: toPublicShift(row) });
  })
);

const patchSchema = z.object({
  location: z.string().trim().max(200).optional(),
  workLocationId: z.string().uuid("Invalid work location").nullable().optional(),
  signIn: z.string().regex(TIME_RE).nullable().optional(),
  signOut: z.string().regex(TIME_RE).nullable().optional(),
});

shiftsRouter.patch(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const localToday = requestLocalDate(req);
    if (!localToday) {
      res.status(400).json({ error: TIME_ZONE_REQUIRED_MESSAGE, code: "INVALID_CLIENT_TIME_ZONE" });
      return;
    }
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

    // A PATCH can touch just one of signIn/signOut — validate the pair as it
    // will actually end up after this update (falling back to whichever side
    // isn't being changed), not just whatever happens to be in this request.
    // `?? null` normalises the one shape zod's `.nullable().optional()` lets
    // through that the rule helpers don't accept: the key present with an
    // explicit `undefined`. Semantically that is "clear this field", the
    // same as null.
    const mergedSignIn = ("signIn" in updates ? updates.signIn : existing.sign_in) ?? null;
    const mergedSignOut = ("signOut" in updates ? updates.signOut : existing.sign_out) ?? null;
    if (mergedSignIn && mergedSignOut && !isNonZeroDuration(mergedSignIn, mergedSignOut)) {
      res.status(400).json({ error: ZERO_LENGTH_MESSAGE });
      return;
    }

    // The duration and overlap rules run ONLY when this request actually
    // changes a time. Shifts saved before these rules existed may well
    // violate them — an 18-hour entry, or a pair that overlaps a neighbour —
    // and re-checking on an untouched pair would make those rows
    // permanently uneditable, including editing the location to correct
    // them, or deleting nothing but a typo. Touch a time and you own the
    // result; touch the location and the times are left exactly as they
    // were. The date is not patchable at all, so it never needs re-checking.
    const timesChanged = "signIn" in updates || "signOut" in updates;
    if (timesChanged) {
      const problem = validateShiftTimes({ date: existing.date, signIn: mergedSignIn, signOut: mergedSignOut }, localToday);
      if (problem) {
        res.status(400).json({ error: problem });
        return;
      }
    }

    // Same one-open-shift-per-user rule as creation (see hasOpenShift above)
    // — this mostly guards against re-opening a previously-completed shift
    // (clearing signOut) while a different shift is already open. The
    // ordinary sign-out PATCH (setting signOut on the one open shift) never
    // trips this: it makes mergedSignOut non-null, so the shift being
    // patched is no longer "open" after the update.
    if (mergedSignIn && !mergedSignOut && (await hasOpenShift(req.userId!, existing.id))) {
      res.status(409).json({ error: OPEN_SHIFT_CONFLICT_MESSAGE });
      return;
    }

    if (
      timesChanged &&
      findOverlap(
        { date: existing.date, signIn: mergedSignIn, signOut: mergedSignOut },
        await neighbouringShifts(req.userId!, existing.date, existing.id)
      )
    ) {
      res.status(409).json({ error: OVERLAP_MESSAGE });
      return;
    }

    const locationChanged = "workLocationId" in updates || "location" in updates;
    let selectedLocation: WorkLocationRow | null = null;
    if (locationChanged) {
      selectedLocation = await findActiveWorkLocation(
        req.userId!,
        updates.workLocationId,
        updates.location
      );
      if (updates.workLocationId && !selectedLocation) {
        res.status(400).json({ error: "Select an active work location" });
        return;
      }
    }

    const setClauses: string[] = [];
    const params: Record<string, InValue> = {
      id: req.params.id,
      userId: req.userId!,
      updatedAt: new Date().toISOString(),
    };
    if ("signIn" in updates) {
      setClauses.push("sign_in = @signIn");
      params.signIn = updates.signIn as InValue;
    }
    if ("signOut" in updates) {
      setClauses.push("sign_out = @signOut");
      params.signOut = updates.signOut as InValue;
    }
    if (locationChanged) {
      const locationSnapshot = selectedLocation?.name
        ?? ("location" in updates ? updates.location ?? "" : "");
      setClauses.push(
        "location = @locationSnapshot",
        "location_snapshot = @locationSnapshot",
        "work_location_id = @workLocationId",
        "fuel_allowance_snapshot_cents = @allowanceSnapshotCents"
      );
      params.locationSnapshot = locationSnapshot;
      params.workLocationId = selectedLocation?.id ?? null;
      params.allowanceSnapshotCents = selectedLocation?.fuel_allowance_cents ?? null;
    }

    const transaction = await db.transaction("write");
    try {
      await transaction.execute({
        sql: `UPDATE shifts SET ${setClauses.join(", ")}, updated_at = @updatedAt
              WHERE id = @id AND user_id = @userId`,
        args: params,
      });
      await recalculateDayFuelAllowance(transaction, req.userId!, existing.date);
      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      if (isUniqueConstraintError(e)) {
        res.status(409).json({ error: OPEN_SHIFT_CONFLICT_MESSAGE });
        return;
      }
      throw e;
    } finally {
      transaction.close();
    }
    const result = await db.execute({
      sql: "SELECT * FROM shifts WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    const row = result.rows[0] as unknown as ShiftRow;
    res.json({ shift: toPublicShift(row) });
  })
);

shiftsRouter.delete(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const existing = await db.execute({
      sql: "SELECT date FROM shifts WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId!],
    });
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }
    const date = String(existing.rows[0].date);
    const transaction = await db.transaction("write");
    try {
      await transaction.execute({
        sql: "DELETE FROM shifts WHERE id = ? AND user_id = ?",
        args: [req.params.id, req.userId!],
      });
      await recalculateDayFuelAllowance(transaction, req.userId!, date);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
    res.status(204).end();
  })
);
