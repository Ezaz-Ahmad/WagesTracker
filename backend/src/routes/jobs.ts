import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db.js";
import { hasAtMostTwoDecimals } from "../fuelAllowances.js";
import {
  publicJob,
  publicRate,
  requestDate,
  userJobs,
  type JobRow,
  type RateRow,
} from "../jobs.js";
import { WEEK_DAYS, startOfWeekISO } from "../weekBoundary.js";
import { isValidDate } from "../security/shiftRules.js";
import { deleteJobRecords, jobDeletionImpact, JobDeletionError, syncPrimaryJobPreferences } from "../jobDeletion.js";
import { toPublicUser, type UserRow } from "../types.js";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);
const rateSchema = z
  .number()
  .positive()
  .max(1000)
  .refine(hasAtMostTwoDecimals, "Use no more than two decimal places");
const fields = {
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120),
  weekStartsOn: z.enum(WEEK_DAYS),
  goalHours: z.number().min(0).max(200),
  goalEarnings: z.number().min(0).max(100000),
  smartRemindersEnabled: z.boolean(),
};
const createSchema = z.object({
  ...fields,
  role: fields.role.default(""),
  weekStartsOn: fields.weekStartsOn.default("Monday"),
  goalHours: fields.goalHours.default(0),
  goalEarnings: fields.goalEarnings.default(0),
  smartRemindersEnabled: fields.smartRemindersEnabled.default(false),
  rate: rateSchema,
});
const patchSchema = z.object({ ...fields, archived: z.boolean() }).partial();
jobsRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const jobs = await userJobs(req.userId!);
    const rates = await db.execute({
      sql: "SELECT * FROM pay_rates WHERE user_id=? ORDER BY effective_from DESC",
      args: [req.userId!],
    });
    res.json({
      jobs: await Promise.all(jobs.map((j) => publicJob(j, requestDate(req)))),
      rates: (rates.rows as unknown as RateRow[]).map(publicRate),
    });
  })
);
jobsRouter.post(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message || "Invalid job" });
      return;
    }
    await userJobs(req.userId!);
    const p = parsed.data,
      id = randomUUID(),
      now = new Date().toISOString();
    const tx = await db.transaction("write");
    try {
    await tx.batch(
      [
        {
          sql: `INSERT INTO jobs(id,user_id,name,role,week_starts_on,goal_hours,goal_earnings,smart_reminders_enabled,created_at,updated_at,is_primary) VALUES(?,?,?,?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE user_id=? AND is_primary=1) THEN 0 ELSE 1 END)`,
          args: [
            id,
            req.userId!,
            p.name,
            p.role,
            p.weekStartsOn,
            p.goalHours,
            p.goalEarnings,
            p.smartRemindersEnabled ? 1 : 0,
            now,
            now,
            req.userId!,
          ],
        },
        {
          sql: `INSERT INTO pay_rates(id,user_id,job_id,location_id,effective_from,rate_cents,created_at) VALUES(?,?,?,NULL,'0001-01-01',?,?)`,
          args: [randomUUID(), req.userId!, id, Math.round(p.rate * 100), now],
        },
      ]
    );
    const primary = await tx.execute({ sql: "SELECT is_primary FROM jobs WHERE id=?", args: [id] });
    if (primary.rows[0]?.is_primary) await syncPrimaryJobPreferences(tx, req.userId!, requestDate(req));
    await tx.commit();
    } catch (error) { await tx.rollback(); throw error; } finally { tx.close(); }
    const row = (
      await db.execute({
        sql: "SELECT * FROM jobs WHERE id=? AND user_id=?",
        args: [id, req.userId!],
      })
    ).rows[0] as unknown as JobRow;
    res.status(201).json({ job: await publicJob(row, requestDate(req)) });
  })
);
jobsRouter.get("/:id/deletion-impact", asyncHandler<AuthedRequest>(async (req, res) => {
  try { res.json(await jobDeletionImpact(db, req.userId!, req.params.id)); }
  catch (error) { if (error instanceof JobDeletionError) { res.status(error.status).json({ error: error.message }); return; } throw error; }
}));
jobsRouter.delete("/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  const parsed = z.object({ confirmationName: z.string().trim().min(1).max(120) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter the job name to confirm permanent deletion." }); return; }
  try {
    const deleted = await deleteJobRecords(db, req.userId!, req.params.id, parsed.data.confirmationName, requestDate(req));
    const account = await db.execute({ sql: "SELECT * FROM users WHERE id=?", args: [req.userId!] });
    res.json({ ...deleted, user: toPublicUser(account.rows[0] as unknown as UserRow) });
  } catch (error) { if (error instanceof JobDeletionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; } throw error; }
}));
jobsRouter.patch(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const p = patchSchema.safeParse(req.body);
    if (!p.success || !Object.keys(p.data).length) {
      res.status(400).json({ error: "Enter valid job settings" });
      return;
    }
    const jobs = await userJobs(req.userId!),
      job = jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (p.data.archived) {
      const open = await db.execute({
        sql: "SELECT id FROM shifts WHERE user_id=? AND job_id=? AND sign_in IS NOT NULL AND sign_out IS NULL LIMIT 1",
        args: [req.userId!, job.id],
      });
      if (open.rows.length) {
        res
          .status(409)
          .json({ error: "End the running shift before archiving this job" });
        return;
      }
      if (!jobs.some((j) => j.id !== job.id && !j.archived_at)) {
        res.status(409).json({ error: "Keep at least one active job" });
        return;
      }
    }
    const tx = await db.transaction("write");
    try {
      if (p.data.archived) {
        const open = await tx.execute({
          sql: "SELECT id FROM shifts WHERE user_id=? AND job_id=? AND sign_in IS NOT NULL AND sign_out IS NULL LIMIT 1",
          args: [req.userId!, job.id],
        });
        const remaining = await tx.execute({
          sql: "SELECT id FROM jobs WHERE user_id=? AND id!=? AND archived_at IS NULL LIMIT 1",
          args: [req.userId!, job.id],
        });
        if (open.rows.length || !remaining.rows.length) {
          await tx.rollback();
          res.status(409).json({
            error: open.rows.length
              ? "End the running shift before archiving this job"
              : "Keep at least one active job",
          });
          return;
        }
      }
      const columns: Record<string, string> = {
        name: "name",
        role: "role",
        weekStartsOn: "week_starts_on",
        goalHours: "goal_hours",
        goalEarnings: "goal_earnings",
        smartRemindersEnabled: "smart_reminders_enabled",
        archived: "archived_at",
      };
      const args: Record<string, string | number | null> = {
        id: job.id,
        userId: req.userId!,
        now: new Date().toISOString(),
      };
      const clauses: string[] = [];
      for (const [k, value] of Object.entries(p.data)) {
        clauses.push(`${columns[k]}=@${k}`);
        args[k] =
          k === "archived"
            ? value
              ? args.now
              : null
            : typeof value === "boolean"
            ? value
              ? 1
              : 0
            : value;
      }
      if (p.data.weekStartsOn && p.data.weekStartsOn !== job.week_starts_on) {
        const extras = await tx.execute({
          sql: "SELECT id,effective_date FROM week_extras WHERE user_id=? AND job_id=?",
          args: [req.userId!, job.id],
        });
        const keys = new Set<string>();
        const moves = extras.rows.map((r) => ({
          id: String(r.id),
          date: startOfWeekISO(String(r.effective_date), p.data.weekStartsOn!),
        }));
        for (const m of moves) {
          if (keys.has(m.date)) {
            await tx.rollback();
            res.status(409).json({
              error:
                "Two weekly extras would overlap under that week start. No records were changed.",
            });
            return;
          }
          keys.add(m.date);
        }
        await tx.execute({
          sql: "UPDATE week_extras SET week_start='__move__' || id WHERE user_id=? AND job_id=?",
          args: [req.userId!, job.id],
        });
        for (const m of moves)
          await tx.execute({
            sql: "UPDATE week_extras SET week_start=? WHERE id=? AND user_id=? AND job_id=?",
            args: [m.date, m.id, req.userId!, job.id],
          });
      }
      await tx.execute({
        sql: `UPDATE jobs SET ${clauses.join(
          ","
        )},updated_at=@now WHERE id=@id AND user_id=@userId`,
        args,
      });
      // Keep the primary workspace's legacy preferences in sync for clients
      // installed before workspaces were introduced.
      if (job.is_primary) {
        const preferences = [
          "weekStartsOn",
          "goalHours",
          "goalEarnings",
          "smartRemindersEnabled",
        ].filter((key) => key in p.data);
        if (preferences.length)
          await tx.execute({
            sql: `UPDATE users SET ${preferences
              .map((key) => `${columns[key]}=@${key}`)
              .join(",")} WHERE id=@userId`,
            args: Object.fromEntries([
              ["userId", req.userId!],
              ...preferences.map((key) => [key, args[key]]),
            ]),
          });
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
    const row = (
      await db.execute({
        sql: "SELECT * FROM jobs WHERE id=? AND user_id=?",
        args: [job.id, req.userId!],
      })
    ).rows[0] as unknown as JobRow;
    res.json({ job: await publicJob(row, requestDate(req)) });
  })
);
jobsRouter.get(
  "/:id/rates",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const jobs = await userJobs(req.userId!);
    if (!jobs.some((j) => j.id === req.params.id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const rows = await db.execute({
      sql: "SELECT * FROM pay_rates WHERE user_id=? AND job_id=? ORDER BY effective_from DESC,created_at DESC",
      args: [req.userId!, req.params.id],
    });
    res.json({ rates: (rows.rows as unknown as RateRow[]).map(publicRate) });
  })
);
jobsRouter.post(
  "/:id/rates",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const p = z
      .object({
        locationId: z.string().min(1).max(120).nullable().default(null),
        rate: rateSchema.nullable(),
        effectiveFrom: z
          .string()
          .refine(isValidDate, "Choose a real effective date"),
        replaceExisting: z.boolean().optional().default(false),
      })
      .safeParse(req.body);
    if (!p.success) {
      res
        .status(400)
        .json({ error: p.error.issues[0]?.message || "Invalid pay change" });
      return;
    }
    const jobs = await userJobs(req.userId!),
      job = jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.archived_at) {
      res
        .status(409)
        .json({ error: "Restore the job before changing its pay" });
      return;
    }
    const { locationId, rate, effectiveFrom } = p.data;
    if (!locationId && rate == null) {
      res.status(400).json({ error: "A job needs a default hourly rate" });
      return;
    }
    if (locationId) {
      const l = await db.execute({
        sql: "SELECT id FROM work_locations WHERE id=? AND user_id=? AND job_id=? AND archived_at IS NULL",
        args: [locationId, req.userId!, job.id],
      });
      if (!l.rows.length) {
        res.status(404).json({ error: "Work location not found in this job" });
        return;
      }
    }
    let id: string = randomUUID();
    const now = new Date().toISOString(),
      cents = rate == null ? null : Math.round(rate * 100);
    const tx = await db.transaction("write");
    let replaced = false;
    try {
      const state = await tx.execute({
        sql: "SELECT archived_at FROM jobs WHERE id=? AND user_id=?",
        args: [job.id, req.userId!],
      });
      if (!state.rows.length || state.rows[0].archived_at) {
        await tx.rollback();
        res
          .status(409)
          .json({ error: "Restore this job before changing its pay" });
        return;
      }
      const existing = await tx.execute({
        sql: "SELECT id FROM pay_rates WHERE job_id=? AND user_id=? AND location_id IS ? AND effective_from=?",
        args: [job.id, req.userId!, locationId, effectiveFrom],
      });
      if (existing.rows.length) {
        if (!p.data.replaceExisting) {
          await tx.rollback();
          res.status(409).json({
            error:
              "A pay change already exists for this date. Review and replace it from Work & pay.",
          });
          return;
        }
        id = String(existing.rows[0].id);
        replaced = true;
        await tx.execute({
          sql: "UPDATE pay_rates SET rate_cents=? WHERE id=? AND user_id=? AND job_id=?",
          args: [cents, id, req.userId!, job.id],
        });
      } else
        await tx.execute({
          sql: "INSERT INTO pay_rates(id,user_id,job_id,location_id,effective_from,rate_cents,created_at) VALUES(?,?,?,?,?,?,?)",
          args: [
            id,
            req.userId!,
            job.id,
            locationId,
            effectiveFrom,
            cents,
            now,
          ],
        });
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
    res.status(replaced ? 200 : 201).json({
      rate: publicRate({
        id,
        user_id: req.userId!,
        job_id: job.id,
        location_id: locationId,
        effective_from: effectiveFrom,
        rate_cents: cents,
        created_at: now,
      }),
      job: await publicJob(job, requestDate(req)),
    });
  })
);
