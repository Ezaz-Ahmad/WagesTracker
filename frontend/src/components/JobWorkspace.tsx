import { LegacyHourlyPay } from "../settings/LegacyHourlyPay";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useApp } from "../context/AppContext";
import type { Job, PayRate, Screen, WorkLocation } from "../lib/types";
import { isoDate, buildWeekDays, fmt2 } from "../lib/date";
import { findOpenShift, weekEarningsFor } from "../lib/aggregate";
import { alignExtrasToWeek, resolveShiftRate } from "../lib/pay";
import { useLiveElapsedHours } from "../lib/useLiveElapsedHours";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
import { Overlay } from "./Overlay";
import { Amount } from "./Amount";
import { AsyncButton } from "./AsyncButton";
import { useConfirm } from "./ConfirmProvider";
import {
  BriefcaseIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EntryIcon,
  LocationPinIcon,
} from "./icons";

const cash = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const dayLabel = (date: string) =>
  date === "0001-01-01"
    ? "Initial rate"
    : new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function JobDialog({
  title,
  description,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const id = useId(),
    closeRef = useRef<HTMLButtonElement>(null);
  const { closing, requestClose } = useDismissTransition(180);
  const dismiss = () => {
    if (!busy) requestClose(onClose);
  };
  const ref = useFocusTrap<HTMLDivElement>(true, dismiss, closeRef);
  return (
    <Overlay>
      <div
        className={`job-dialog-backdrop${closing ? " is-closing" : ""}`}
        onMouseDown={(e) => {
          if (e.currentTarget === e.target) dismiss();
        }}
      >
        <section
          className={`job-dialog${closing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          aria-describedby={description ? `${id}-description` : undefined}
          ref={ref}
          tabIndex={-1}
        >
          <div className="job-dialog-handle" aria-hidden="true" />
          <header className="job-dialog-header">
            <div>
              <h2 id={id}>{title}</h2>
              {description && <p id={`${id}-description`}>{description}</p>}
            </div>
            <button
              ref={closeRef}
              type="button"
              className="btn btn-icon btn-ghost"
              aria-label={`Close ${title}`}
              onClick={dismiss}
              disabled={busy}
            >
              <CloseIcon size={18} />
            </button>
          </header>
          <div className="job-dialog-content">{children}</div>
        </section>
      </div>
    </Overlay>
  );
}

export function CreateJobDialog({ onClose }: { onClose: () => void }) {
  const { createJob } = useApp();
  const [name, setName] = useState(""),
    [role, setRole] = useState(""),
    [rate, setRate] = useState(""),
    [week, setWeek] = useState<Job["weekStartsOn"]>("Monday");
  const [hours, setHours] = useState(""),
    [earnings, setEarnings] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const id = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createJob({
        name: name.trim(),
        role: role.trim(),
        rate: Number(rate),
        weekStartsOn: week,
        goalHours: Number(hours) || 0,
        goalEarnings: Number(earnings) || 0,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create this job");
    } finally {
      setBusy(false);
    }
  }
  return (
    <JobDialog
      title="Add another job"
      description="Give this job its own pay, shifts, locations and goals."
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <label className="field" htmlFor={`${id}-name`}>
          Job or employer name
          <input
            id={`${id}-name`}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder="e.g. Riverside Hotel"
          />
        </label>
        <label className="field field-spaced" htmlFor={`${id}-role`}>
          Role <span className="field-optional">Optional</span>
          <input
            id={`${id}-role`}
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            maxLength={120}
            placeholder="e.g. Front desk assistant"
          />
        </label>
        <div className="job-field-grid">
          <label className="field" htmlFor={`${id}-rate`}>
            Hourly rate (AUD)
            <input
              id={`${id}-rate`}
              className="input"
              type="number"
              inputMode="decimal"
              min="0.01"
              max="1000"
              step="0.01"
              required
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="30.00"
            />
          </label>
          <label className="field" htmlFor={`${id}-week`}>
            Work week starts
            <select
              id={`${id}-week`}
              className="input"
              value={week}
              onChange={(e) => setWeek(e.target.value as Job["weekStartsOn"])}
            >
              {[
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
              ].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
        <details className="job-optional">
          <summary>
            Weekly goals <span className="field-optional">Optional</span>
          </summary>
          <div className="job-field-grid">
            <label className="field" htmlFor={`${id}-hours`}>
              Hours
              <input
                id={`${id}-hours`}
                className="input"
                type="number"
                min="0"
                max="200"
                step="0.25"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </label>
            <label className="field" htmlFor={`${id}-goal`}>
              Earnings (AUD)
              <input
                id={`${id}-goal`}
                className="input"
                type="number"
                min="0"
                max="100000"
                step="0.01"
                value={earnings}
                onChange={(e) => setEarnings(e.target.value)}
              />
            </label>
          </div>
        </details>
        <p className="job-notice">
          Add work locations and any custom location rates in this job’s Work &
          pay settings.
        </p>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        <AsyncButton
          type="submit"
          className="btn btn-primary job-full"
          busy={busy}
          idleLabel="Create job"
          busyLabel="Creating job…"
        />
      </form>
    </JobDialog>
  );
}

export function JobSwitcher({ onManageJobs }: { onManageJobs: () => void }) {
  const {
    jobs = [],
    selectedJobId,
    selectedJob,
    selectJob,
    allShifts = [],
  } = useApp();
  const [open, setOpen] = useState(false),
    [adding, setAdding] = useState(false);
  const active = findOpenShift(allShifts),
    activeJobs = jobs.filter((j) => !j.archived);
  if (!jobs.length) return null;
  return (
    <div className="workspace-strip">
      <button
        type="button"
        className="workspace-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="job-monogram" aria-hidden="true">
          {selectedJob ? (
            initials(selectedJob.name)
          ) : (
            <BriefcaseIcon size={18} />
          )}
        </span>
        <span className="workspace-trigger-text">
          <strong>{selectedJob?.name || "All jobs"}</strong>
          <span>
            {selectedJob
              ? [selectedJob.role, `${cash(selectedJob.rate)}/hr default`]
                  .filter(Boolean)
                  .join(" · ")
              : `${jobs.length} jobs · combined overview`}
          </span>
        </span>
        <ChevronDownIcon size={16} />
      </button>
      {selectedJob?.archived && (
        <p className="job-notice">
          Archived job · your history and PDFs are available. Restore it in
          Settings → Your jobs to make changes.
        </p>
      )}
      {active && active.jobId !== selectedJobId && (
        <button
          className="workspace-running"
          type="button"
          onClick={() => selectJob(active.jobId || activeJobs[0]?.id || "all")}
        >
          <span className="job-live-dot" />
          {active.jobName ||
            jobs.find((j) => j.id === active.jobId)?.name ||
            "Another job"}{" "}
          is on shift <ChevronRightIcon size={14} />
        </button>
      )}
      {open && (
        <JobDialog
          title="Choose your view"
          description="Switch jobs without signing out."
          onClose={() => setOpen(false)}
        >
          <div className="job-choice-list">
            {jobs.length > 1 && (
              <button
                type="button"
                className={`job-choice${
                  selectedJobId === "all" ? " is-selected" : ""
                }`}
                onClick={() => {
                  selectJob("all");
                  setOpen(false);
                }}
              >
                <span className="job-monogram">
                  <BriefcaseIcon size={19} />
                </span>
                <span>
                  <strong>All jobs</strong>
                  <small>Combined earnings & work history</small>
                </span>
                {selectedJobId === "all" && <CheckIcon size={18} />}
              </button>
            )}
            {jobs.map((j) => (
              <button
                type="button"
                key={j.id}
                className={`job-choice${
                  selectedJobId === j.id ? " is-selected" : ""
                }`}
                onClick={() => {
                  selectJob(j.id);
                  setOpen(false);
                }}
              >
                <span className="job-monogram">{initials(j.name)}</span>
                <span>
                  <strong>
                    {j.name}{" "}
                    {j.archived && (
                      <span className="job-rate-badge">Archived</span>
                    )}
                    {active?.jobId === j.id && (
                      <span className="job-live-badge">On shift</span>
                    )}
                  </strong>
                  <small>
                    {j.role ? `${j.role} · ` : ""}
                    {cash(j.rate)}/hr default
                  </small>
                </span>
                {selectedJobId === j.id && <CheckIcon size={18} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary job-full"
            onClick={() => {
              setOpen(false);
              setAdding(true);
            }}
          >
            Add another job
          </button>
          <button
            type="button"
            className="job-text-button job-full"
            onClick={() => {
              setOpen(false);
              onManageJobs();
            }}
          >
            Manage jobs
          </button>
        </JobDialog>
      )}
      {adding && <CreateJobDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

export function JobsSettings({ onOpenWorkPay }: { onOpenWorkPay: () => void }) {
  const { jobs = [], selectJob, updateJob } = useApp();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<Job | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  async function archive(j: Job) {
    if (
      !j.archived &&
      !(await confirm(
        `Archive ${j.name}? Past shifts, earnings and reports stay available.`
      ))
    )
      return;
    setBusy(j.id);
    setError(null);
    try {
      await updateJob(j.id, { archived: !j.archived });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update this job");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="jobs-settings">
      <div className="job-section-heading">
        <div>
          <h3>Your jobs</h3>
          <p className="field-hint">
            Choose a job to manage its pay, locations and goals.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => setAdding(true)}>
          Add job
        </button>
      </div>
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      <div className="job-settings-list">
        {jobs.map((j) => (
          <article
            key={j.id}
            className={`card job-settings-card${
              j.archived ? " is-archived" : ""
            }`}
          >
            <button
              type="button"
              className="job-settings-open"
              onClick={() => {
                selectJob(j.id);
                onOpenWorkPay();
              }}
            >
              <span className="job-monogram">{initials(j.name)}</span>
              <span>
                <strong>{j.name}</strong>
                <small>
                  {j.archived
                    ? "Archived · history preserved"
                    : `${cash(j.rate)}/hr default · ${
                        j.weekStartsOn
                      } week start`}
                </small>
                <span className="job-text-link">Work & pay →</span>
              </span>
              <ChevronRightIcon size={18} />
            </button>
            <div className="job-settings-actions">
              <button className="job-text-button" onClick={() => setEditing(j)}>
                Edit job & goals
              </button>
              <button
                className="job-text-button"
                disabled={busy === j.id}
                onClick={() => void archive(j)}
              >
                {busy === j.id
                  ? "Saving…"
                  : j.archived
                  ? "Restore job"
                  : "Archive job"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {adding && <CreateJobDialog onClose={() => setAdding(false)} />}
      {editing && (
        <EditJobDialog job={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function EditJobDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const { updateJob } = useApp();
  const [name, setName] = useState(job.name),
    [role, setRole] = useState(job.role),
    [week, setWeek] = useState(job.weekStartsOn),
    [hours, setHours] = useState(String(job.goalHours)),
    [earnings, setEarnings] = useState(String(job.goalEarnings));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const id = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateJob(job.id, {
        name: name.trim(),
        role: role.trim(),
        weekStartsOn: week,
        goalHours: Number(hours),
        goalEarnings: Number(earnings),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this job");
    } finally {
      setBusy(false);
    }
  }
  return (
    <JobDialog
      title="Edit job & goals"
      description={job.name}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <label className="field" htmlFor={`${id}-name`}>
          Job name
          <input
            id={`${id}-name`}
            required
            maxLength={120}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field field-spaced" htmlFor={`${id}-role`}>
          Role
          <input
            id={`${id}-role`}
            maxLength={120}
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        <label className="field field-spaced" htmlFor={`${id}-week`}>
          Work week starts
          <select
            id={`${id}-week`}
            className="input"
            value={week}
            onChange={(e) => setWeek(e.target.value as Job["weekStartsOn"])}
          >
            {[
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
            ].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <div className="job-field-grid">
          <label className="field" htmlFor={`${id}-hours`}>
            Hours goal
            <input
              id={`${id}-hours`}
              className="input"
              type="number"
              min="0"
              max="200"
              step="0.25"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
          <label className="field" htmlFor={`${id}-goal`}>
            Earnings goal (AUD)
            <input
              id={`${id}-goal`}
              className="input"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              value={earnings}
              onChange={(e) => setEarnings(e.target.value)}
            />
          </label>
        </div>
        <p className="job-notice">
          Changing the week start reorganises this job’s weekly extras around
          their original dates. Shifts keep their dates and rates.
        </p>
        {error && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
        <AsyncButton
          type="submit"
          className="btn btn-primary job-full"
          busy={busy}
          idleLabel="Save job"
          busyLabel="Saving…"
        />
      </form>
    </JobDialog>
  );
}

export function PayRateEditor({
  job,
  location,
  onClose,
}: {
  job: Job;
  location?: WorkLocation;
  onClose: () => void;
}) {
  const { addPayRate, payRates, today, allShifts } = useApp(),
    id = useId();
  const current = resolveShiftRate(
    job,
    payRates,
    location?.id ?? null,
    isoDate(today)
  );
  const confirm = useConfirm();
  const [reviewing, setReviewing] = useState(false);
  const [mode, setMode] = useState<"job" | "location">(
      location ? current.source : "location"
    ),
    [rate, setRate] = useState(String(current.rate)),
    [effective, setEffective] = useState(isoDate(today)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const saved = allShifts.find(
    (s) =>
      s.jobId === job.id &&
      (!location || s.workLocationId === location.id) &&
      s.signIn &&
      s.signOut
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const existing = payRates.find(
      (r) =>
        r.jobId === job.id &&
        r.locationId === (location?.id ?? null) &&
        r.effectiveFrom === effective
    );
    setReviewing(true);
    const approved = !(
      existing &&
      !(await confirm(
        `Replace the pay change for ${
          location?.name || job.name
        } from ${dayLabel(effective)}? New entries for that date use ${
          location && mode === "job"
            ? "the job default"
            : `${cash(Number(rate))}/hr`
        }. Saved and running shifts keep their recorded pay.`
      ))
    );
    setReviewing(false);
    if (!approved) return;
    setBusy(true);
    setError(null);
    try {
      await addPayRate(job.id, {
        locationId: location?.id ?? null,
        rate: location && mode === "job" ? null : Number(rate),
        effectiveFrom: effective,
        replaceExisting: !!existing,
      });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't save this pay change"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <JobDialog
      title={location ? `${location.name} pay` : "Job default pay"}
      description={`${job.name} · hourly rate`}
      onClose={onClose}
      busy={busy || reviewing}
    >
      <form onSubmit={submit}>
        {location ? (
          <fieldset className="job-rate-options">
            <legend>How is this location paid?</legend>
            <label>
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === "job"}
                onChange={() => setMode("job")}
              />
              <span>
                <strong>Use job default</strong>
                <small>
                  {cash(job.rate)}/hr · follows this job’s pay changes
                </small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === "location"}
                onChange={() => setMode("location")}
              />
              <span>
                <strong>Set a custom hourly rate</strong>
                <small>Only for shifts at {location.name}</small>
              </span>
            </label>
          </fieldset>
        ) : (
          <p className="job-notice">
            Locations using the job default follow this change. Custom location
            rates keep their own settings.
          </p>
        )}
        <div className="job-field-grid">
          <label className="field" htmlFor={`${id}-rate`}>
            New hourly rate (AUD)
            <input
              id={`${id}-rate`}
              className="input"
              type="number"
              inputMode="decimal"
              min="0.01"
              max="1000"
              step="0.01"
              value={rate}
              disabled={!!location && mode === "job"}
              required
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <label className="field" htmlFor={`${id}-date`}>
            Effective from
            <input
              id={`${id}-date`}
              className="input"
              type="date"
              min="2000-01-01"
              required
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
            />
          </label>
        </div>
        <div className="job-pay-preview">
          {cash(current.rate)}/hr today →{" "}
          {location && mode === "job"
            ? "job default"
            : `${cash(Number(rate) || 0)}/hr`}{" "}
          from {effective ? dayLabel(effective) : "the selected date"}.
        </div>
        {saved && (
          <div className="job-recorded-rate">
            <span>Saved shift keeps its recorded rate</span>
            <strong>
              {dayLabel(saved.date)} · {cash(saved.appliedRate ?? job.rate)}/hr
            </strong>
          </div>
        )}
        <p className="job-notice">
          New entries use the rate for their worked date. Saved and running
          shifts keep their applied rate. Correct past pay by explicitly editing
          that shift.
        </p>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        <AsyncButton
          type="submit"
          className="btn btn-primary job-full"
          busy={busy}
          idleLabel="Save pay change"
          busyLabel="Saving pay…"
        />
      </form>
    </JobDialog>
  );
}

export function JobPayPanel() {
  const {
    user,
    selectedJob,
    payRates = [],
    workLocations = [],
    today,
  } = useApp();
  const [editing, setEditing] = useState<"default" | WorkLocation | null>(null),
    [history, setHistory] = useState(false);
  if (!user?.workspacesEnabled) return <LegacyHourlyPay />;
  if (!selectedJob)
    return (
      <p className="job-notice">
        Choose a job above to manage its pay and locations.
      </p>
    );
  const pending = payRates.filter(
    (r) =>
      r.jobId === selectedJob.id &&
      r.locationId === null &&
      r.effectiveFrom > isoDate(today)
  );
  return (
    <>
      <section className="job-default-pay card">
        <div className="job-section-heading">
          <span className="job-eyebrow">
            {selectedJob.name} · default hourly rate
          </span>
          <button
            type="button"
            className="job-text-button"
            onClick={() => setHistory(true)}
          >
            Rate history
          </button>
        </div>
        <div className="job-pay-value-row">
          <strong>
            <Amount>{cash(selectedJob.rate)}</Amount>
            <small> / hr</small>
          </strong>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEditing("default")}
            disabled={selectedJob.archived}
          >
            Update rate
          </button>
        </div>
        <p className="field-hint">
          Used at locations that follow the job default.
        </p>
        {pending.map((r) => (
          <p key={r.id} className="job-scheduled-rate">
            {cash(r.rate ?? selectedJob.rate)}/hr from{" "}
            {dayLabel(r.effectiveFrom)}
          </p>
        ))}
      </section>
      <div className="job-section-heading job-location-pay-heading">
        <h3>Location pay rates</h3>
        <span className="field-hint">
          {workLocations.filter((l) => !l.archived).length} locations
        </span>
      </div>
      <div className="job-location-rates">
        {workLocations
          .filter((l) => !l.archived)
          .map((l) => {
            const pay = resolveShiftRate(
              selectedJob,
              payRates,
              l.id,
              isoDate(today)
            );
            const future = payRates.filter(
              (r) => r.locationId === l.id && r.effectiveFrom > isoDate(today)
            );
            return (
              <article className="card job-location-pay" key={l.id}>
                <div className="job-section-heading">
                  <h4>{l.name}</h4>
                  <span
                    className={`job-rate-badge${
                      pay.source === "location" ? " is-custom" : ""
                    }`}
                  >
                    {pay.source === "location"
                      ? "Custom rate"
                      : "Uses job default"}
                  </span>
                </div>
                <div className="job-pay-value-row">
                  <strong>
                    <Amount>{cash(pay.rate)}</Amount>
                    <small> / hr</small>
                  </strong>
                  <button
                    className="job-text-button"
                    onClick={() => setEditing(l)}
                    disabled={selectedJob.archived}
                  >
                    Edit pay <ChevronRightIcon size={15} />
                  </button>
                </div>
                <p className="field-hint">
                  {l.fuelAllowance == null
                    ? "No fuel allowance"
                    : `${cash(l.fuelAllowance)} fuel allowance per worked day`}
                </p>
                {future.map((r) => (
                  <p key={r.id} className="job-scheduled-rate">
                    {r.rate == null ? "Job default" : `${cash(r.rate)}/hr`} from{" "}
                    {dayLabel(r.effectiveFrom)}
                  </p>
                ))}
              </article>
            );
          })}
      </div>
      {editing && (
        <PayRateEditor
          job={selectedJob}
          location={editing === "default" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {history && (
        <JobDialog
          title="Rate history"
          description={`${selectedJob.name} · recorded shifts keep their rates`}
          onClose={() => setHistory(false)}
        >
          <div className="job-rate-history">
            {payRates
              .filter((r) => r.jobId === selectedJob.id)
              .map((r) => (
                <RateHistoryRow
                  key={r.id}
                  rate={r}
                  locations={workLocations}
                  today={isoDate(today)}
                />
              ))}
          </div>
          <p className="job-notice">
            If one location uses different rates in a week, each shift keeps its
            own rate in the wage PDF.
          </p>
        </JobDialog>
      )}
    </>
  );
}
function RateHistoryRow({
  rate,
  locations,
  today,
}: {
  rate: PayRate;
  locations: WorkLocation[];
  today: string;
}) {
  return (
    <div className="job-rate-history-row">
      <div>
        <strong>
          {rate.rate == null ? "Use job default" : `${cash(rate.rate)} / hr`}
        </strong>
        <span>
          {rate.locationId
            ? locations.find((l) => l.id === rate.locationId)?.name ||
              "Historical location"
            : "Job default"}{" "}
          · {dayLabel(rate.effectiveFrom)}
        </span>
      </div>
      {rate.effectiveFrom > today && (
        <span className="job-rate-badge">Scheduled</span>
      )}
    </div>
  );
}

export function AllJobsOverview({
  onNavigate,
}: {
  onNavigate: (screen: Screen) => void;
}) {
  const {
    jobs = [],
    allShifts = [],
    allDayExpenses = [],
    allWeekExtras = [],
    selectJob,
    today,
    user,
    shiftsLoaded,
  } = useApp();
  const [adding, setAdding] = useState(false);
  const open = findOpenShift(allShifts),
    liveHours = useLiveElapsedHours(!!open, open?.signIn ?? null),
    week = buildWeekDays(today, "Monday"),
    start = week[0],
    startISO = isoDate(start),
    endISO = isoDate(week[6]);
  const summaries = useMemo(
    () =>
      jobs.map((j) => ({
        job: j,
        totals: weekEarningsFor(
          start,
          allShifts.filter((s) => s.jobId === j.id),
          allDayExpenses.filter((e) => e.jobId === j.id),
          alignExtrasToWeek(
            allWeekExtras.filter((e) => e.jobId === j.id),
            "Monday"
          ),
          j.rate
        ),
      })),
    [jobs, allShifts, allDayExpenses, allWeekExtras, startISO]
  );
  const liveInWeek = !!open && open.date >= startISO && open.date <= endISO;
  const live = liveInWeek
    ? liveHours *
      (open?.appliedRate ?? jobs.find((j) => j.id === open?.jobId)?.rate ?? 0)
    : 0;
  const total = summaries.reduce((s, j) => s + j.totals.earnings, 0) + live,
    hours =
      summaries.reduce((s, j) => s + j.totals.hours, 0) +
      (liveInWeek ? liveHours : 0),
    goal = user?.goalEarnings ?? 0;
  if (!shiftsLoaded)
    return (
      <div className="job-overview-loading" role="status">
        Loading your jobs…
      </div>
    );
  return (
    <div className="screen-wide jobs-overview">
      <div className="job-overview-title">
        <h1>Your week, together.</h1>
        <p>
          {start.toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
          })}
          –
          {week[6].toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}{" "}
          · Monday–Sunday
        </p>
      </div>
      <div className="job-overview-grid">
        <div>
          <section className="job-overview-hero">
            <div className="job-section-heading">
              <span className="job-eyebrow">All jobs · same date range</span>
              {liveInWeek && (
                <span className="job-live-badge">Live estimate</span>
              )}
            </div>
            <div className="job-overview-amount">
              <Amount>{cash(total)}</Amount>
            </div>
            <p>
              {fmt2(hours)} hours across {jobs.length} jobs · before tax
            </p>
            <div className="job-overview-hero-footer">
              <span>Wages + allowances + extras</span>
              <span>AUD</span>
            </div>
          </section>
          {open && (
            <button
              type="button"
              className="job-active-banner"
              onClick={() => selectJob(open.jobId || jobs[0]?.id || "all")}
            >
              <EntryIcon size={20} />
              <span>
                <strong>
                  {open.jobName || jobs.find((j) => j.id === open.jobId)?.name}
                </strong>
                <small>{open.location} · shift in progress</small>
              </span>
              <ChevronRightIcon size={16} />
            </button>
          )}
          {goal > 0 && (
            <section className="job-combined-goal">
              <div className="job-section-heading">
                <h2>Combined weekly goal</h2>
                <span>{Math.round(Math.min(100, (total / goal) * 100))}%</span>
              </div>
              <p>
                <Amount>
                  {cash(total)} of {cash(goal)}
                </Amount>
              </p>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Combined earnings goal"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round((total / goal) * 100))}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, (total / goal) * 100)}%` }}
                />
              </div>
            </section>
          )}
        </div>
        <section>
          <div className="job-section-heading">
            <h2>Your jobs</h2>
            <button className="job-text-button" onClick={() => setAdding(true)}>
              + Add job
            </button>
          </div>
          <div className="job-overview-list">
            {summaries.map(({ job: j, totals: t }) => (
              <button
                type="button"
                key={j.id}
                className="card job-overview-row"
                onClick={() => selectJob(j.id)}
              >
                <span className="job-monogram">{initials(j.name)}</span>
                <span>
                  <strong>
                    {j.name}
                    {j.archived && (
                      <span className="job-rate-badge">Archived</span>
                    )}
                    {open?.jobId === j.id && (
                      <span className="job-live-badge">On shift</span>
                    )}
                  </strong>
                  <small>
                    {fmt2(
                      t.hours +
                        (liveInWeek && open?.jobId === j.id ? liveHours : 0)
                    )}
                    h · {cash(j.rate)}/hr default
                  </small>
                </span>
                <strong className="job-overview-job-total">
                  <Amount>
                    {cash(t.earnings + (open?.jobId === j.id ? live : 0))}
                  </Amount>
                </strong>
              </button>
            ))}
          </div>
          <div className="card job-spending-link">
            <LocationPinIcon size={18} />
            <span>
              <strong>Personal spending</strong>
              <small>One ledger across all your jobs</small>
            </span>
            <button
              className="job-text-button"
              onClick={() => onNavigate("spending")}
            >
              View →
            </button>
          </div>
        </section>
      </div>
      {adding && <CreateJobDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

export function ChooseJobForEntry() {
  const { jobs = [], selectJob } = useApp();
  return (
    <div className="screen-narrow">
      <h1 className="section-title">Choose a job</h1>
      <p className="section-hint">
        Select the job you worked for. Its locations and rates will follow.
      </p>
      <div className="job-choice-list">
        {jobs
          .filter((j) => !j.archived)
          .map((j) => (
            <button
              type="button"
              className="card job-choice"
              key={j.id}
              onClick={() => selectJob(j.id)}
            >
              <span className="job-monogram">{initials(j.name)}</span>
              <span>
                <strong>{j.name}</strong>
                <small>{cash(j.rate)}/hr default</small>
              </span>
              <ChevronRightIcon size={18} />
            </button>
          ))}
      </div>
    </div>
  );
}
