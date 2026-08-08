import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { useDirtyForm } from "../lib/useDirtyForm";
import { parseNumberField } from "../lib/numberField";
import { SettingsSaveBar } from "./SettingsSaveBar";

interface GoalDraft {
  goalHoursRaw: string;
  goalEarningsRaw: string;
}

export function GoalSettings() {
  const { user, updateSettings } = useApp();
  const { values, setValues, dirty, markSaved } = useDirtyForm<GoalDraft>({
    goalHoursRaw: user?.goalHours ? String(user.goalHours) : "",
    goalEarningsRaw: user?.goalEarnings ? String(user.goalEarnings) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) return null;

  const hoursField = parseNumberField(values.goalHoursRaw, { min: 0, max: 200 });
  const earningsField = parseNumberField(values.goalEarningsRaw, { min: 0, max: 100000 });

  function update(patch: Partial<GoalDraft>) {
    setValues({ ...values, ...patch });
    setSuccess(false);
  }

  function handleAutoGoal() {
    if (!hoursField.valid) return;
    const computed = Math.round(user!.rate * hoursField.value * 100) / 100;
    update({ goalEarningsRaw: String(computed) });
  }

  async function handleSave() {
    if (!hoursField.valid || !earningsField.valid) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateSettings({ goalHours: hoursField.value, goalEarnings: earningsField.value });
      markSaved(values);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your goals. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-section-card card">
      <div className="field field-spaced">
        <label htmlFor="settings-goal-hours">Weekly hours goal</label>
        <input
          id="settings-goal-hours"
          className="input"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 35"
          value={values.goalHoursRaw}
          onChange={(e) => update({ goalHoursRaw: e.target.value })}
          aria-invalid={!hoursField.valid}
          aria-describedby={!hoursField.valid ? "settings-goal-hours-error" : undefined}
        />
        {!hoursField.valid && (
          <div id="settings-goal-hours-error" className="field-hint field-hint-danger">
            {hoursField.error}
          </div>
        )}
      </div>
      <div className="field field-spaced">
        <label htmlFor="settings-goal-earnings">Weekly earnings goal ({CURRENCY})</label>
        <input
          id="settings-goal-earnings"
          className="input"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 650"
          value={values.goalEarningsRaw}
          onChange={(e) => update({ goalEarningsRaw: e.target.value })}
          aria-invalid={!earningsField.valid}
          aria-describedby={!earningsField.valid ? "settings-goal-earnings-error" : undefined}
        />
        {!earningsField.valid && (
          <div id="settings-goal-earnings-error" className="field-hint field-hint-danger">
            {earningsField.error}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-ghost" onClick={handleAutoGoal} disabled={!hoursField.valid} style={{ marginBottom: "var(--space-2)" }}>
        Set goal = rate × hour goal
      </button>

      <SettingsSaveBar
        saving={saving}
        dirty={dirty}
        success={success}
        error={error}
        onSave={handleSave}
        disabled={!hoursField.valid || !earningsField.valid}
      />
    </div>
  );
}
