import type { Client, Transaction } from "@libsql/client";
import type { JobRow } from "./jobs.js";

export class JobDeletionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Explicitly mirror the current primary job for older installed clients. */
export async function syncPrimaryJobPreferences(tx: Transaction, userId: string, date: string) {
  const result = await tx.execute({ sql: "SELECT * FROM jobs WHERE user_id=? AND is_primary=1", args: [userId] });
  const job = result.rows[0] as unknown as JobRow | undefined;
  const locations = job ? await tx.execute({ sql: "SELECT name,address FROM work_locations WHERE user_id=? AND job_id=? AND archived_at IS NULL ORDER BY created_at,id", args: [userId, job.id] }) : { rows: [] };
  const rates = job ? await tx.execute({ sql: "SELECT rate_cents FROM pay_rates WHERE user_id=? AND job_id=? AND location_id IS NULL AND effective_from<=? ORDER BY effective_from DESC LIMIT 1", args: [userId, job.id, date] }) : { rows: [] };
  await tx.execute({
    sql: `UPDATE users SET work_location_name=?,work_address=?,multiple_locations=?,other_locations='',
      rate=?,week_starts_on=?,goal_hours=?,goal_earnings=?,smart_reminders_enabled=?,jobs_initialized=1 WHERE id=?`,
    args: [job?.name ?? "", String(locations.rows[0]?.address ?? ""), locations.rows.length > 1 ? 1 : 0,
      Number(rates.rows[0]?.rate_cents ?? 0) / 100, job?.week_starts_on ?? "Monday", job?.goal_hours ?? 0,
      job?.goal_earnings ?? 0, job?.smart_reminders_enabled ?? 0, userId],
  });
}

export async function jobDeletionImpact(db: Client, userId: string, jobId: string) {
  const result = await db.execute({
    sql: `SELECT j.id,j.name,
      (SELECT COUNT(*) FROM shifts WHERE user_id=j.user_id AND job_id=j.id) AS shifts,
      (SELECT COUNT(*) FROM work_locations WHERE user_id=j.user_id AND job_id=j.id) AS locations,
      (SELECT COUNT(*) FROM pay_rates WHERE user_id=j.user_id AND job_id=j.id) AS payRates,
      (SELECT COUNT(*) FROM day_expenses WHERE user_id=j.user_id AND job_id=j.id) AS fuelAllowances,
      (SELECT COUNT(*) FROM week_extras WHERE user_id=j.user_id AND job_id=j.id) AS weeklyExtras,
      (SELECT COUNT(*) FROM personal_expenses WHERE user_id=j.user_id AND job_id=j.id) AS linkedExpenses,
      EXISTS(SELECT 1 FROM shifts WHERE user_id=j.user_id AND job_id=j.id AND sign_in IS NOT NULL AND sign_out IS NULL) AS running,
      (SELECT COUNT(*) FROM jobs WHERE user_id=j.user_id)=1 AS lastJob
      FROM jobs j WHERE j.id=? AND j.user_id=?`,
    args: [jobId, userId],
  });
  const row = result.rows[0];
  if (!row) throw new JobDeletionError(404, "Job not found");
  return { jobId: String(row.id), name: String(row.name), hasRunningShift: !!row.running, lastJob: !!row.lastJob,
    counts: Object.fromEntries(["shifts", "locations", "payRates", "fuelAllowances", "weeklyExtras", "linkedExpenses"].map(key => [key, Number(row[key])])) };
}

/** The ownership check, running-shift guard, cascade and promotion are atomic.
 * Explicit deletes are required because remote libSQL FK settings may differ. */
export async function deleteJobRecords(db: Client, userId: string, jobId: string, confirmationName: string, date: string) {
  const tx = await db.transaction("write");
  try {
    const result = await tx.execute({ sql: "SELECT * FROM jobs WHERE id=? AND user_id=?", args: [jobId, userId] });
    const job = result.rows[0] as unknown as JobRow | undefined;
    if (!job) throw new JobDeletionError(404, "Job not found");
    if (confirmationName.trim() !== job.name) throw new JobDeletionError(409, "The job name does not match. Review the job and try again.");
    const open = await tx.execute({ sql: "SELECT id FROM shifts WHERE user_id=? AND job_id=? AND sign_in IS NOT NULL AND sign_out IS NULL LIMIT 1", args: [userId, jobId] });
    if (open.rows.length) throw new JobDeletionError(409, "End the running shift before deleting this job.");
    for (const table of ["personal_expenses", "shifts", "day_expenses", "week_extras", "pay_rates", "work_locations"]) {
      await tx.execute({ sql: `DELETE FROM ${table} WHERE user_id=? AND job_id=?`, args: [userId, jobId] });
    }
    await tx.execute({ sql: "DELETE FROM jobs WHERE id=? AND user_id=?", args: [jobId, userId] });
    const remaining = await tx.execute({ sql: "SELECT id FROM jobs WHERE user_id=? ORDER BY archived_at IS NOT NULL,is_primary DESC,created_at,id LIMIT 1", args: [userId] });
    const nextJobId = remaining.rows[0] ? String(remaining.rows[0].id) : null;
    if (job.is_primary && nextJobId) await tx.execute({ sql: "UPDATE jobs SET is_primary=1,updated_at=? WHERE id=? AND user_id=?", args: [new Date().toISOString(), nextJobId, userId] });
    if (job.is_primary || !nextJobId) await syncPrimaryJobPreferences(tx, userId, date);
    await tx.commit();
    return { deletedJobId: jobId, nextJobId };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally { tx.close(); }
}
