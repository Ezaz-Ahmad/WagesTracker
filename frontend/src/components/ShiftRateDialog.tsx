import { useId, useState, type FormEvent } from "react";
import { useApp } from "../context/AppContext";
import { computeHours, fmt2 } from "../lib/date";
import { AsyncButton } from "./AsyncButton";
import { JobDialog } from "./JobWorkspace";

/** Current-week corrections use the same reviewed mutation as History. */
export function ShiftRateDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { shifts, user, selectedJob, updateShiftOrThrow } = useApp();
  const shift = shifts.find(item => item.id === shiftId);
  const id = useId();
  const [rate, setRate] = useState(String(shift?.appliedRate ?? user?.rate ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!shift) return <JobDialog title="Shift unavailable" onClose={onClose}><p>This shift is no longer available. Close this view and refresh your records.</p></JobDialog>;
  const previous = shift.appliedRate ?? user?.rate ?? 0;
  const hours = computeHours(shift.signIn, shift.signOut);
  const valid = rate.trim() !== "" && Number(rate) > 0 && Number(rate) <= 1000 && Math.abs(Number(rate) * 100 - Math.round(Number(rate) * 100)) < 1e-7;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy || Number(rate) === previous) return;
    setBusy(true);setError(null);
    try {
      await updateShiftOrThrow(shiftId, { rateOverride: Number(rate) });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't update the recorded rate.");
    } finally { setBusy(false); }
  }
  return <JobDialog title="Review recorded pay" description={`${shift.jobName || selectedJob?.name || "Job"} · ${shift.date} · ${shift.location || "No location"}`} onClose={onClose} busy={busy}>
    <form onSubmit={save}>
      <p className="job-notice">This corrects this shift only. Job defaults and location pay schedules keep their own rates.</p>
      <label className="field" htmlFor={id}>Recorded hourly rate (AUD)<input id={id} className="input" type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" required disabled={busy} value={rate} onChange={event => { setRate(event.target.value);setError(null); }} /></label>
      <div className="job-pay-preview">${fmt2(previous)}/hr → ${valid ? fmt2(Number(rate)) : "—"}/hr<br />{fmt2(hours)}h · ${fmt2(Math.round(hours * previous * 100) / 100)} → ${valid ? fmt2(Math.round(hours * Number(rate) * 100) / 100) : "—"} wages</div>
      <p className="field-hint">You’ll confirm the old and new rate before anything is saved.</p>
      {error && <p role="alert" className="settings-error">{error}</p>}
      <AsyncButton type="submit" className="btn btn-primary job-full" disabled={!valid || Number(rate) === previous} busy={busy} idleLabel="Review & save correction" busyLabel="Reviewing pay…" />
    </form>
  </JobDialog>;
}
