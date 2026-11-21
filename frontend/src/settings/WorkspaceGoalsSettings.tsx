import { useId, useState, type FormEvent } from "react";
import { useApp } from "../context/AppContext";
import { AsyncButton } from "../components/AsyncButton";
import { Amount } from "../components/Amount";

export function WorkspaceGoalsSettings() {
  const { user, jobs = [], updateSettings } = useApp();
  const id = useId();
  const [goal, setGoal] = useState(
      String(user?.combinedGoalEarnings || user?.goalEarnings || 0)
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await updateSettings({ combinedGoalEarnings: Number(goal) });
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't save the combined goal"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-section-card card">
      <h3>Combined weekly earnings goal</h3>
      <p className="field-hint">
        One target across all jobs, using Monday–Sunday. Each job keeps its own
        goals and work week.
      </p>
      <form onSubmit={save}>
        <p className="field-hint">
          Enter 0 to follow the sum of your active jobs’ earnings goals
          automatically.
        </p>
        <label className="field field-spaced" htmlFor={id}>
          Overall earnings goal (AUD)
          <input
            className="input"
            type="number"
            inputMode="decimal"
            id={id}
            min="0"
            max="100000"
            step="0.01"
            required
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="settings-success" role="status">
            Combined goal saved.
          </p>
        )}
        <AsyncButton
          type="submit"
          className="btn btn-primary"
          busy={busy}
          idleLabel="Save combined goal"
          busyLabel="Saving…"
        />
      </form>
      <div className="job-rate-history">
        {jobs
          .filter((j) => !j.archived)
          .map((j) => (
            <div className="job-rate-history-row" key={j.id}>
              <div>
                <strong>{j.name}</strong>
                <span>{j.goalHours}h weekly hours goal</span>
              </div>
              <Amount>${j.goalEarnings.toFixed(2)}</Amount>
            </div>
          ))}
      </div>
    </div>
  );
}
