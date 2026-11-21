import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { buildWeekDays, isoDate } from "../lib/date";
import { usePdfDownload } from "../lib/usePdfDownload";
import { AsyncButton } from "./AsyncButton";
import { JobDialog } from "./JobWorkspace";

/** Export an employer's work week without changing the current workspace. */
export function PdfExportDialog({
  onClose,
  weekAnchor,
}: {
  onClose: () => void;
  weekAnchor?: Date;
}) {
  const { user, jobs, today, selectedJobId } = useApp();
  const [scope, setScope] = useState(selectedJobId);
  const { download, downloading, justDownloaded, error } = usePdfDownload();
  if (!user) return null;
  const job = jobs.find((item) => item.id === scope);
  const reportUser = job
    ? {
        ...user,
        rate: job.rate,
        weekStartsOn: job.weekStartsOn,
        workLocationName: job.name,
        workAddress: "",
        multipleLocations: true,
      }
    : { ...user, weekStartsOn: "Monday" as const, workAddress: "" };
  const days = buildWeekDays(weekAnchor ?? today, reportUser.weekStartsOn);
  const range = `${days[0].toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  })} – ${days[6].toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
  return (
    <JobDialog
      title="Export wage report"
      description="Choose who this report is for."
      onClose={onClose}
      busy={downloading}
    >
      <fieldset className="job-rate-options" disabled={downloading}>
        <legend>Report scope</legend>
        <label>
          <input
            type="radio"
            name="pdf-scope"
            checked={scope === "all"}
            onChange={() => setScope("all")}
          />
          <span>
            <strong>All jobs · personal summary</strong>
            <small>
              Combined Monday–Sunday totals with each job clearly labelled.
            </small>
          </span>
        </label>
        {jobs.map((item) => (
          <label key={item.id}>
            <input
              type="radio"
              name="pdf-scope"
              checked={scope === item.id}
              onChange={() => setScope(item.id)}
            />
            <span>
              <strong>
                {item.name}
                {item.archived ? " · archived" : ""}
              </strong>
              <small>
                {item.weekStartsOn} week start · only this job’s shifts and pay
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="job-pay-preview">
        <strong>{range}</strong>
        <br />
        Each shift shows its recorded hourly rate and wages. Fuel and other
        earnings are listed separately.
      </div>
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      {justDownloaded && (
        <p role="status" className="settings-success">
          Report prepared successfully.
        </p>
      )}
      <AsyncButton
        type="button"
        className="btn btn-primary job-full"
        busy={downloading}
        idleLabel={justDownloaded ? "Download again" : "Download PDF"}
        busyLabel="Preparing PDF…"
        onClick={() =>
          void download({
            user: reportUser,
            today,
            currency: CURRENCY,
            weekAnchor: weekAnchor ?? today,
            jobScope: scope,
          })
        }
      />
      <p className="field-hint">
        {scope === "all"
          ? "For your own records. Choose an individual job when sharing with an employer."
          : `Includes only ${
              job?.name ?? "this job"
            }. Uses its work week containing ${isoDate(weekAnchor ?? today)}.`}
      </p>
    </JobDialog>
  );
}
