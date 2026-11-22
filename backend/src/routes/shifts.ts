import { jobScope, resolvePay } from "../jobs.js";
import type { InValue, Transaction } from "@libsql/client";
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db, pruneExpiredShifts } from "../db.js";
import { recalculateDayFuelAllowance } from "../fuelAllowances.js";
import { shiftConflictResponse, type ConflictShift } from "../security/shiftConflict.js";
import {
  requireAuth,
  signShiftClockOutToken,
  verifyShiftClockOutToken,
  type AuthedRequest,
} from "../auth.js";
import { toPublicShift, type ShiftRow, type WorkLocationRow } from "../types.js";
import {
  FUTURE_DATE_MESSAGE,
  CLIENT_TIME_ZONE_HEADER,
  OVERLAP_MESSAGE,
  TIME_ZONE_REQUIRED_MESSAGE,
  ZERO_LENGTH_MESSAGE as SHARED_ZERO_LENGTH_MESSAGE,
  durationSeconds,
  findOverlaps,
  isSupportedIanaTimeZone,
  localDateForTimeZone,
  validateShiftTimes,
} from "../security/shiftRules.js";

export const shiftsRouter = Router();

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

function requestLocalDate(req: Request): string | null {
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
  excludeId?: string,
  database: Pick<Transaction,"execute"> = db
): Promise<(ConflictShift & { id: string })[]> {
  const day = Date.parse(`${date}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const sql = `${conflictShiftSelect} WHERE s.user_id = ? AND s.date BETWEEN ? AND ?${excludeId ? " AND s.id != ?" : ""} ORDER BY s.date, s.sign_in, s.id`;
  const args = excludeId
    ? [userId, iso(day - 86_400_000), iso(day + 86_400_000), excludeId]
    : [userId, iso(day - 86_400_000), iso(day + 86_400_000)];
  const result = await database.execute({ sql, args });
  return result.rows.map(conflictShiftFromRow);
}

const conflictShiftSelect = `SELECT s.id, s.date, s.sign_in, s.sign_out,
  COALESCE(NULLIF(j.name, ''), NULLIF(s.job_name_snapshot, ''), 'Your job') AS job_name,
  COALESCE(NULLIF(s.location_snapshot, ''), s.location, '') AS location_name
  FROM shifts s LEFT JOIN jobs j ON j.id = COALESCE(s.job_id, 'job_' || s.user_id) AND j.user_id = s.user_id`;

function conflictShiftFromRow(row: Record<string, unknown>): ConflictShift & { id: string } {
  return { id: String(row.id), date: String(row.date), jobName: String(row.job_name), location: String(row.location_name), signIn: row.sign_in == null ? null : String(row.sign_in), signOut: row.sign_out == null ? null : String(row.sign_out) };
}

function attemptedShift(req: AuthedRequest, times: { date: string; signIn: string | null; signOut: string | null }, location: string): ConflictShift {
  return { ...times, jobName: req.job?.name || "Your job", location };
}

async function overlapConflict(userId: string, attempted: ConflictShift, excludeId?: string, database: Pick<Transaction, "execute"> = db) {
  const conflicts = findOverlaps(attempted, await neighbouringShifts(userId, attempted.date, excludeId, database));
  return conflicts.length ? shiftConflictResponse("overlap", attempted, conflicts) : null;
}

async function runningConflict(userId: string, attempted: ConflictShift, excludeId?: string) {
  const result = await db.execute({ sql: `${conflictShiftSelect} WHERE s.user_id = ? AND s.sign_in IS NOT NULL AND s.sign_out IS NULL${excludeId ? " AND s.id != ?" : ""} ORDER BY s.date, s.sign_in, s.id LIMIT 1`, args: excludeId ? [userId, excludeId] : [userId] });
  return result.rows.length ? shiftConflictResponse("running", attempted, result.rows.map(conflictShiftFromRow)) : null;
}

// A shift is "open" — signed in, not yet signed out — for exactly as long
// as it's still in progress. At most one of these should ever exist per
// user; without enforcing that, two tabs or devices (or a slow retry after
// a dropped response) could each create their own open shift, and the
// frontend's "one active shift" model (see useTodayShift.ts) would have no
// well-defined shift to actually act on.
const OPEN_SHIFT_CONFLICT_MESSAGE = "You already have an open shift. Sign out of it before starting another.";

// The partial unique index in db.ts (idx_shifts_one_open_per_user) is what
// actually stops a race between two near-simultaneous requests — the
// runningConflict() check above this can't, since both could read "no open
// shift" before either has committed. This is what turns that index's raw
// constraint-violation error into the same clean 409 response the upfront
// check produces in the non-race case, rather than a generic 500.
function isUniqueConstraintError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /unique constraint failed:\s*shifts\.user_id|idx_shifts_one_open/i.test(message);
}

async function findActiveWorkLocation(
  userId: string,
  workLocationId: string | null | undefined,
  legacyName?: string,
  jobId?: string
): Promise<WorkLocationRow | null> {
  if (workLocationId) {
    const result = await db.execute({
      sql: "SELECT * FROM work_locations WHERE id = ? AND user_id = ? AND job_id = ? AND archived_at IS NULL",
      args: [workLocationId, userId, jobId || `job_${userId}`],
    });
    return (result.rows[0] as unknown as WorkLocationRow | undefined) ?? null;
  }
  const normalized = legacyName?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
  if (!normalized) return null;
  const result = await db.execute({
    sql: "SELECT * FROM work_locations WHERE user_id = ? AND normalized_name = ? AND archived_at IS NULL",
    args: [userId, `${jobId || `job_${userId}`}:${normalized}`],
  });
  return (result.rows[0] as unknown as WorkLocationRow | undefined) ?? null;
}

const clockOutSchema = z.object({
  signOut: z.string().regex(TIME_RE, "signOut must be HH:MM or HH:MM:SS"),
});

interface ClockOutResult {
  shift: ShiftRow;
  alreadyEnded: boolean;
  finalDurationSeconds: number;
}

/**
 * The one authoritative live clock-out write, shared by the signed-in app
 * and the native notification action. The conditional UPDATE is the
 * idempotency boundary: the first request fixes sign_out; later taps/replays
 * return that same completed row and can never overwrite its finish time.
 */
async function clockOutForUser(
  userId: string,
  shiftId: string,
  signOut: string,
  localToday: string
): Promise<ClockOutResult | null> {
  const existingResult = await db.execute({
    sql: `SELECT s.*, j.name AS current_job_name FROM shifts s
          LEFT JOIN jobs j ON j.id = COALESCE(s.job_id, 'job_' || s.user_id) AND j.user_id = s.user_id
          WHERE s.id = ? AND s.user_id = ?`,
    args: [shiftId, userId],
  });
  const existing = existingResult.rows[0] as unknown as (ShiftRow & { current_job_name?: string | null }) | undefined;
  if (!existing) return null;

  if (existing.sign_out) {
    return {
      shift: existing,
      alreadyEnded: true,
      finalDurationSeconds: existing.sign_in
        ? durationSeconds(existing.sign_in, existing.sign_out)
        : 0,
    };
  }
  if (!existing.sign_in) return null;

  const problem = validateShiftTimes(
    { date: existing.date, signIn: existing.sign_in, signOut },
    localToday
  );
  if (problem) throw Object.assign(new Error(problem), { statusCode: 400 });
  const attempted: ConflictShift = { jobName: existing.current_job_name || existing.job_name_snapshot || "Your job", location: existing.location_snapshot || existing.location, date: existing.date, signIn: existing.sign_in, signOut };
  const conflict = await overlapConflict(userId, attempted, existing.id);
  if (conflict) {
    throw Object.assign(new Error(conflict.error), { statusCode: 409, conflictResponse: conflict });
  }

  const transaction = await db.transaction("write");
  try {
    const update = await transaction.execute({
      sql: `UPDATE shifts SET sign_out = ?, updated_at = ?
            WHERE id = ? AND user_id = ? AND sign_out IS NULL`,
      args: [signOut, new Date().toISOString(), shiftId, userId],
    });
    const alreadyEnded = Number(update.rowsAffected) === 0;
    if (!alreadyEnded) {
      await recalculateDayFuelAllowance(transaction, userId, existing.date, existing.job_id || `job_${userId}`);
    }
    const finalResult = await transaction.execute({
      sql: "SELECT * FROM shifts WHERE id = ? AND user_id = ?",
      args: [shiftId, userId],
    });
    const shift = finalResult.rows[0] as unknown as ShiftRow | undefined;
    if (!shift?.sign_in || !shift.sign_out) {
      await transaction.rollback();
      return null;
    }
    await transaction.commit();
    return {
      shift,
      alreadyEnded,
      finalDurationSeconds: durationSeconds(shift.sign_in, shift.sign_out),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

async function handleClockOut(
  req: Request,
  res: Response,
  userId: string,
  includeConflictDetails = false
): Promise<void> {
  const localToday = requestLocalDate(req);
  if (!localToday) {
    res.status(400).json({ error: TIME_ZONE_REQUIRED_MESSAGE, code: "INVALID_CLIENT_TIME_ZONE" });
    return;
  }
  const parsed = clockOutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    return;
  }
  try {
    const result = await clockOutForUser(userId, req.params.id, parsed.data.signOut, localToday);
    if (!result) {
      res.status(404).json({ error: "Active shift not found" });
      return;
    }
    res.json({
      shift: toPublicShift(result.shift),
      alreadyEnded: result.alreadyEnded,
      finalDurationSeconds: result.finalDurationSeconds,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    if (statusCode === 400 || statusCode === 409) {
      const conflict = (error as { conflictResponse?: ReturnType<typeof shiftConflictResponse> }).conflictResponse;
      if (conflict) {
        // A Lock Screen credential can end one shift; it must not disclose
        // the owner's other jobs or their schedules.
        res.status(statusCode).json(includeConflictDetails ? conflict : { error: `${OVERLAP_MESSAGE} Open Wages Tracker to review the job and times.`, code: "SHIFT_OVERLAP" });
        return;
      }
      res.status(statusCode).json({ error: error instanceof Error ? error.message : "Could not end shift" });
      return;
    }
    throw error;
  }
}

// This one route intentionally sits before requireAuth. It accepts only the
// short-lived, single-shift credential issued below — never a general session
// token — so a Lock Screen action still works after the app's ordinary idle
// timeout without granting the native surface access to any other account API.
shiftsRouter.post(
  "/:id/clock-out-action",
  asyncHandler(async (req, res) => {
    const token = req.get("X-Shift-Clock-Out-Token") || "";
    const userId = verifyShiftClockOutToken(token, req.params.id);
    if (!userId) {
      res.status(401).json({ error: "Invalid or expired shift action token" });
      return;
    }
    await handleClockOut(req, res, userId);
  })
);

shiftsRouter.use(requireAuth, jobScope);

shiftsRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await pruneExpiredShifts();
    const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : null;

    let query = "SELECT * FROM shifts WHERE user_id = ?";
    if(req.jobId) query += " AND COALESCE(job_id,'job_' || user_id) = ?";
    const params: unknown[] = req.jobId ? [req.userId!,req.jobId] : [req.userId!];
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

/** Reissues the narrow native-action credential after an app/device restart. */
shiftsRouter.post(
  "/:id/clock-out-token",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const result = await db.execute({
      sql: `SELECT * FROM shifts
            WHERE id = ? AND user_id = ? AND sign_in IS NOT NULL AND sign_out IS NULL`,
      args: [req.params.id, req.userId!],
    });
    const shift = result.rows[0] as unknown as ShiftRow | undefined;
    if (!shift) {
      res.status(404).json({ error: "Active shift not found" });
      return;
    }
    res.json({ clockOutToken: signShiftClockOutToken(req.userId!, shift.id) });
  })
);

/** Signed-in equivalent of the Lock Screen action, using the same atomic path. */
shiftsRouter.post(
  "/:id/clock-out",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await handleClockOut(req, res, req.userId!, true);
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
    allowFutureDate: z.boolean().optional().default(false),
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
    const { date, location, workLocationId, signIn, signOut, allowFutureDate } = parsed.data;

    const selectedLocation = await findActiveWorkLocation(req.userId!, workLocationId, location, req.jobId!);
    if (workLocationId && !selectedLocation) {
      res.status(400).json({ error: "Choose an available work location" });
      return;
    }
    const locationSnapshot = selectedLocation?.name ?? location;
    const selectedLocationId = selectedLocation?.id ?? null;
    const allowanceSnapshotCents = selectedLocation?.fuel_allowance_cents ?? null;

    // Real-calendar-date, future-date and zero-duration checks. Applied
    // to every create, not just historical ones — see security/shiftRules.ts.
    const problem = validateShiftTimes({ date, signIn, signOut }, localToday, { allowFutureDate });
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }

    // Only a shift that would itself be "open" needs this check — a
    // complete shift (both times set, or neither) can never conflict with
    // an already-open one.
    const attempted = attemptedShift(req, { date, signIn, signOut }, locationSnapshot);
    const running = signIn && !signOut ? await runningConflict(req.userId!, attempted) : null;
    if (running) {
      res.status(409).json(running);
      return;
    }

    // 409 rather than 400: the shift itself is well-formed, it conflicts
    // with existing state — the same distinction the open-shift rule draws.
    const conflict = await overlapConflict(req.userId!, attempted);
    if (conflict) {
      res.status(409).json(conflict);
      return;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const transaction = await db.transaction("write");
    try {
      const jobState=await transaction.execute({sql:"SELECT archived_at FROM jobs WHERE id=? AND user_id=?",args:[req.jobId!,req.userId!]});
      if(!jobState.rows.length||jobState.rows[0].archived_at){await transaction.rollback();res.status(409).json({error:"This job is archived. Restore it before adding shifts."});return;}
      const transactionConflict = await overlapConflict(req.userId!, attempted, undefined, transaction);
      if (transactionConflict) { await transaction.rollback(); res.status(409).json(transactionConflict); return; }
      const pay = await resolvePay(transaction, req.userId!, req.jobId!, selectedLocationId, date);
      await transaction.execute({
        sql: `INSERT INTO shifts
              (id, user_id, job_id, applied_rate_cents, rate_source, job_name_snapshot, date, location, work_location_id, location_snapshot,
               fuel_allowance_snapshot_cents, sign_in, sign_out, created_at, updated_at)
              VALUES (@id, @userId, @jobId, @appliedRateCents, @rateSource, @jobName, @date, @location, @workLocationId, @locationSnapshot,
                      @allowanceSnapshotCents, @signIn, @signOut, @now, @now)`,
        args: {
          id,
          userId: req.userId!,
          jobId:req.jobId!, appliedRateCents:pay.cents, rateSource:pay.source, jobName:req.job!.name,
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
      await recalculateDayFuelAllowance(transaction, req.userId!, date, req.jobId!);
      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      if (isUniqueConstraintError(e)) {
        res.status(409).json(await runningConflict(req.userId!, attempted) ?? { error: OPEN_SHIFT_CONFLICT_MESSAGE, code: "OPEN_SHIFT_EXISTS" });
        return;
      }
      throw e;
    } finally {
      transaction.close();
    }

    const result = await db.execute({ sql: "SELECT * FROM shifts WHERE id = ?", args: [id] });
    const row = result.rows[0] as unknown as ShiftRow;
    res.status(201).json({
      shift: toPublicShift(row),
      ...(row.sign_in && !row.sign_out
        ? { clockOutToken: signShiftClockOutToken(req.userId!, row.id) }
        : {}),
    });
  })
);

const patchSchema = z.object({
  location: z.string().trim().max(200).optional(),
  workLocationId: z.string().uuid("Invalid work location").nullable().optional(),
  signIn: z.string().regex(TIME_RE).nullable().optional(),
  signOut: z.string().regex(TIME_RE).nullable().optional(),
  confirmRateChange: z.boolean().optional().default(false),
  rateOverride: z.number().positive().max(1000).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-7).optional(),
  allowFutureDate: z.boolean().optional().default(false),
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
      sql: "SELECT * FROM shifts WHERE id = ? AND user_id = ? AND COALESCE(job_id,'job_' || user_id) = ?",
      args: [req.params.id, req.userId!, req.jobId!],
    });
    const existing = existingResult.rows[0] as unknown as ShiftRow | undefined;
    if (!existing) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }

    const { allowFutureDate, confirmRateChange, rateOverride, ...updates } = parsed.data;
    const keys = Object.keys(updates) as (keyof typeof updates)[];
    if (keys.length === 0 && rateOverride === undefined) {
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
      const problem = validateShiftTimes(
        { date: existing.date, signIn: mergedSignIn, signOut: mergedSignOut },
        localToday,
        { allowFutureDate }
      );
      if (problem) {
        res.status(400).json({ error: problem });
        return;
      }
    }

    // Same one-open-shift-per-user rule as creation (see runningConflict above)
    // — this mostly guards against re-opening a previously-completed shift
    // (clearing signOut) while a different shift is already open. The
    // ordinary sign-out PATCH (setting signOut on the one open shift) never
    // trips this: it makes mergedSignOut non-null, so the shift being
    // patched is no longer "open" after the update.
    const attempted = attemptedShift(req, { date: existing.date, signIn: mergedSignIn, signOut: mergedSignOut }, "location" in updates ? updates.location || "" : "workLocationId" in updates ? "" : existing.location_snapshot || existing.location);
    const running = mergedSignIn && !mergedSignOut ? await runningConflict(req.userId!, attempted, existing.id) : null;
    if (running) {
      res.status(409).json(running);
      return;
    }

    const conflict = timesChanged ? await overlapConflict(req.userId!, attempted, existing.id) : null;
    if (conflict) {
      res.status(409).json(conflict);
      return;
    }

    const locationChanged = "workLocationId" in updates || "location" in updates;
    let selectedLocation: WorkLocationRow | null = null;
    if (locationChanged) {
      selectedLocation = await findActiveWorkLocation(
        req.userId!,
        updates.workLocationId,
        updates.location,
        req.jobId!
      );
      if (updates.workLocationId && !selectedLocation) {
        res.status(400).json({ error: "Choose an available work location" });
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

    if(locationChanged || rateOverride !== undefined){
      const pay=rateOverride!==undefined?{cents:Math.round(rateOverride*100),source:"manual"}:await resolvePay(db,req.userId!,req.jobId!,selectedLocation?.id ?? null,existing.date);
      if(existing.applied_rate_cents!=null && pay.cents!==existing.applied_rate_cents && !confirmRateChange){res.status(409).json({error:`This shift's recorded rate would change from $${(existing.applied_rate_cents/100).toFixed(2)}/hr to $${(pay.cents/100).toFixed(2)}/hr. Review and confirm before saving.`,code:"RATE_CHANGE_CONFIRMATION_REQUIRED",previousRate:existing.applied_rate_cents/100,proposedRate:pay.cents/100});return;}
      setClauses.push("applied_rate_cents=@appliedRate","rate_source=@rateSource");params.appliedRate=pay.cents;params.rateSource=pay.source;
    }
    const transaction = await db.transaction("write");
    try {
      const jobState=await transaction.execute({sql:"SELECT archived_at FROM jobs WHERE id=? AND user_id=?",args:[req.jobId!,req.userId!]});
      if(!jobState.rows.length||jobState.rows[0].archived_at){await transaction.rollback();res.status(409).json({error:"Restore this job before editing its shifts."});return;}
      const current=await transaction.execute({sql:"SELECT updated_at FROM shifts WHERE id=? AND user_id=?",args:[existing.id,req.userId!]});
      if(current.rows[0]?.updated_at!==existing.updated_at){await transaction.rollback();res.status(409).json({error:"This shift changed on another device. Refresh it before saving again."});return;}
      const transactionConflict = timesChanged ? await overlapConflict(req.userId!, attempted, existing.id, transaction) : null;
      if (transactionConflict) { await transaction.rollback(); res.status(409).json(transactionConflict); return; }
      await transaction.execute({
        sql: `UPDATE shifts SET ${setClauses.join(", ")}, updated_at = @updatedAt
              WHERE id = @id AND user_id = @userId`,
        args: params,
      });
      await recalculateDayFuelAllowance(transaction, req.userId!, existing.date, req.jobId!);
      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      if (isUniqueConstraintError(e)) {
        res.status(409).json(await runningConflict(req.userId!, attempted, existing.id) ?? { error: OPEN_SHIFT_CONFLICT_MESSAGE, code: "OPEN_SHIFT_EXISTS" });
        return;
      }
      throw e;
    } finally {
      transaction.close();
    }
    const result = await db.execute({
      sql: "SELECT * FROM shifts WHERE id = ? AND user_id = ? AND COALESCE(job_id,'job_' || user_id) = ?",
      args: [req.params.id, req.userId!, req.jobId!],
    });
    const row = result.rows[0] as unknown as ShiftRow;
    res.json({ shift: toPublicShift(row) });
  })
);

shiftsRouter.delete(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const existing = await db.execute({
      sql: "SELECT date FROM shifts WHERE id = ? AND user_id = ? AND COALESCE(job_id,'job_' || user_id) = ?",
      args: [req.params.id, req.userId!, req.jobId!],
    });
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }
    const date = String(existing.rows[0].date);
    const transaction = await db.transaction("write");
    try {
      await transaction.execute({
        sql: "DELETE FROM shifts WHERE id = ? AND user_id = ? AND COALESCE(job_id,'job_' || user_id) = ?",
        args: [req.params.id, req.userId!, req.jobId!],
      });
      await recalculateDayFuelAllowance(transaction, req.userId!, date, req.jobId!);
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
