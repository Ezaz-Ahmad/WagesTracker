import type { Client, Transaction } from "@libsql/client";
import type { NextFunction, Response } from "express";
import { db } from "./db.js";
import { ensureUserJob } from "./jobMigration.js";
import type { AuthedRequest } from "./auth.js";
import {
  localDateForTimeZone,
  isSupportedIanaTimeZone,
} from "./security/shiftRules.js";
import type { WeekStart } from "./weekBoundary.js";

export interface JobRow {
  id: string;
  user_id: string;
  name: string;
  role: string;
  week_starts_on: WeekStart;
  goal_hours: number;
  goal_earnings: number;
  smart_reminders_enabled: number;
  is_primary: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface JobRequest extends AuthedRequest {
  jobId?: string | null;
  job?: JobRow;
}
export interface RateRow {
  id: string;
  user_id: string;
  job_id: string;
  location_id: string | null;
  effective_from: string;
  rate_cents: number | null;
  created_at: string;
}
type Executor = Pick<Client, "execute"> | Pick<Transaction, "execute">;
export function requestDate(req: AuthedRequest): string {
  const zone = req.get("x-client-time-zone");
  return zone && isSupportedIanaTimeZone(zone)
    ? localDateForTimeZone(new Date(), zone)
    : new Date().toISOString().slice(0, 10);
}
export async function userJobs(userId: string): Promise<JobRow[]> {
  let r = await db.execute({
    sql: "SELECT * FROM jobs WHERE user_id=? ORDER BY archived_at IS NOT NULL,is_primary DESC,created_at,id",
    args: [userId],
  });
  if (!r.rows.length) {
    const tx = await db.transaction("write");
    try {
      await ensureUserJob(tx, userId);
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
    r = await db.execute({
      sql: "SELECT * FROM jobs WHERE user_id=? ORDER BY archived_at IS NOT NULL,is_primary DESC,created_at,id",
      args: [userId],
    });
  }
  return r.rows as unknown as JobRow[];
}
export async function resolvePay(
  database: Executor,
  userId: string,
  jobId: string,
  locationId: string | null,
  date: string
): Promise<{ cents: number; source: "job" | "location" }> {
  if (locationId) {
    const local = await database.execute({
      sql: "SELECT rate_cents FROM pay_rates WHERE user_id=? AND job_id=? AND location_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1",
      args: [userId, jobId, locationId, date],
    });
    if (local.rows[0]?.rate_cents != null)
      return { cents: Number(local.rows[0].rate_cents), source: "location" };
  }
  const r = await database.execute({
    sql: "SELECT rate_cents FROM pay_rates WHERE user_id=? AND job_id=? AND location_id IS NULL AND effective_from<=? ORDER BY effective_from DESC LIMIT 1",
    args: [userId, jobId, date],
  });
  if (!r.rows.length)
    throw Object.assign(
      new Error("No hourly rate is configured for this worked date"),
      { statusCode: 400 }
    );
  return { cents: Number(r.rows[0].rate_cents), source: "job" };
}
export async function publicJob(row: JobRow, date: string) {
  const rate = await resolvePay(db, row.user_id, row.id, null, date);
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    weekStartsOn: row.week_starts_on,
    rate: rate.cents / 100,
    goalHours: row.goal_hours,
    goalEarnings: row.goal_earnings,
    smartRemindersEnabled: !!row.smart_reminders_enabled,
    isPrimary: !!row.is_primary,
    archived: !!row.archived_at,
    createdAt: row.created_at,
  };
}
export function publicRate(row: RateRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    locationId: row.location_id,
    effectiveFrom: row.effective_from,
    rate: row.rate_cents == null ? null : row.rate_cents / 100,
    createdAt: row.created_at,
  };
}
/** Old clients retain their primary job; all is an explicit read-only scope. */
export async function jobScope(
  req: JobRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const jobs = await userJobs(req.userId!);
    const id =
      req.get("x-work-job") ||
      (typeof req.query.jobId === "string" ? req.query.jobId : undefined);
    if (id === "all") {
      if (
        req.method !== "GET" &&
        !(
          req.method === "POST" &&
          /^\/[^/]+\/clock-out(?:-token)?$/.test(req.path)
        )
      ) {
        res.status(400).json({ error: "Choose a job before making changes" });
        return;
      }
      req.jobId = null;
      next();
      return;
    }
    const job = jobs.find(
      (j) => j.id === (id || jobs.find((j) => j.is_primary)?.id)
    );
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (
      job.archived_at &&
      req.method !== "GET" &&
      !/clock-out/.test(req.path)
    ) {
      res
        .status(409)
        .json({
          error:
            "This job is archived. Restore it before adding or editing records.",
        });
      return;
    }
    req.jobId = job.id;
    req.job = job;
    next();
  } catch (e) {
    next(e);
  }
}
