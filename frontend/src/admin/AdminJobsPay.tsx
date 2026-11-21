import { useState } from "react";
import type { Job, PayRate, WorkLocation } from "../lib/types";
import { resolveShiftRate } from "../lib/pay";
import { isoDate } from "../lib/date";
import { adminMoney } from "./AdminUserEarnings";

/** Read-only operational context. Financial changes stay in the account's
 * reviewed pay flow; the admin never silently rewrites recorded wages. */
export function AdminJobsPay({
  jobs = [],
  rates = [],
  locations = [],
}: {
  jobs?: Job[];
  rates?: PayRate[];
  locations?: WorkLocation[];
}) {
  const [selected, setSelected] = useState("all");
  const today = isoDate(new Date());
  const visible = jobs.filter((j) => selected === "all" || j.id === selected);
  return (
    <section className="admin-jobs-pay" aria-label="Jobs and pay settings">
      <div className="admin-earnings-heading">
        <div>
          <p className="admin-eyebrow">Workspaces & pay history</p>
          <h3>
            {jobs.length} {jobs.length === 1 ? "job" : "jobs"} ·{" "}
            {jobs.filter((j) => !j.archived).length} active
          </h3>
        </div>
        <label className="admin-job-select">
          Job
          <select
            className="input"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="all">All jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
                {j.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {visible.map((j) => (
        <article className="admin-job-card" key={j.id}>
          <div className="admin-job-card-heading">
            <div>
              <h4>{j.name}</h4>
              <p>
                {j.role || "Role not provided"} · {j.weekStartsOn} week start
              </p>
            </div>
            <span
              className={`admin-job-status${j.archived ? " is-archived" : ""}`}
            >
              {j.archived ? "Archived" : "Active"}
            </span>
          </div>
          <dl className="admin-job-metrics">
            <div>
              <dt>Default pay</dt>
              <dd>{adminMoney(j.rate)}/hr</dd>
            </div>
            <div>
              <dt>Weekly hours goal</dt>
              <dd>{j.goalHours}h</dd>
            </div>
            <div>
              <dt>Earnings goal</dt>
              <dd>{adminMoney(j.goalEarnings)}</dd>
            </div>
            <div>
              <dt>Smart reminders</dt>
              <dd>{j.smartRemindersEnabled ? "Enabled" : "Off"}</dd>
            </div>
          </dl>
          <div className="admin-shifts-table-wrap">
            <table className="table admin-job-locations">
              <thead>
                <tr>
                  <th>Work location</th>
                  <th>Current rate</th>
                  <th>Fuel / day</th>
                </tr>
              </thead>
              <tbody>
                {locations
                  .filter((l) => l.jobId === j.id)
                  .map((l) => {
                    const rate = resolveShiftRate(j, rates, l.id, today);
                    return (
                      <tr key={l.id}>
                        <td>
                          {l.name}
                          {l.archived && <small>Archived location</small>}
                        </td>
                        <td>
                          {adminMoney(rate.rate)}/hr
                          <small>
                            {rate.source === "location"
                              ? "Location rate"
                              : "Job default"}
                          </small>
                        </td>
                        <td>
                          {l.fuelAllowance == null
                            ? "—"
                            : adminMoney(l.fuelAllowance)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <details className="admin-job-rate-history">
            <summary>
              Effective-dated pay history (
              {rates.filter((r) => r.jobId === j.id).length})
            </summary>
            <div>
              {rates
                .filter((r) => r.jobId === j.id)
                .map((r) => (
                  <div key={r.id}>
                    <span>
                      <strong>
                        {r.locationId
                          ? locations.find((l) => l.id === r.locationId)
                              ?.name || "Historical location"
                          : "Job default"}
                      </strong>
                      <small>
                        {r.effectiveFrom === "0001-01-01"
                          ? "Initial rate"
                          : r.effectiveFrom}
                        {r.effectiveFrom > today ? " · Scheduled" : ""}
                      </small>
                    </span>
                    <strong>
                      {r.rate == null
                        ? "Use job default"
                        : `${adminMoney(r.rate)}/hr`}
                    </strong>
                  </div>
                ))}
            </div>
          </details>
        </article>
      ))}
      <p className="admin-calculation-note">
        Each saved shift uses its recorded hourly rate. Location and default pay
        changes apply by effective date; they do not recalculate saved shifts.
      </p>
    </section>
  );
}
