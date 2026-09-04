import { useState } from "react";
import { useApp } from "../context/AppContext";
import { useDirtyForm } from "../lib/useDirtyForm";
import type { WeekStart } from "../lib/types";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { WEEK_DAYS, weekEndDay } from "../lib/weekBoundary.mjs";
import { ActiveShiftActivitySettings } from "./ActiveShiftActivitySettings";
import { LayoutCustomizer } from "../components/LayoutCustomizer";
import { ChevronRightIcon, SlidersIcon } from "../components/icons";
import { ThemeSettings } from "./ThemeSettings";

interface ProfileDraft {
  name: string;
  address: string;
  weekStartsOn: WeekStart;
}

export function ProfileSettings() {
  const { user, updateSettings } = useApp();
  const { values, setValues, dirty, markSaved } = useDirtyForm<ProfileDraft>({
    name: user?.name ?? "",
    address: user?.address ?? "",
    weekStartsOn: user?.weekStartsOn ?? "Monday",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  if (!user) return null;

  function update(patch: Partial<ProfileDraft>) {
    setValues({ ...values, ...patch });
    setSuccess(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateSettings(values);
      markSaved(values);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your profile. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="settings-section-card card">
        <div className="field field-spaced">
          <label htmlFor="settings-name">Your name</label>
          <input
            id="settings-name"
            className="input"
            type="text"
            placeholder="Alex Rivera"
            value={values.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className="field field-spaced">
          <label htmlFor="settings-address">Your address</label>
          <input
            id="settings-address"
            className="input"
            type="text"
            placeholder="123 Main St, Springfield"
            value={values.address}
            onChange={(e) => update({ address: e.target.value })}
          />
          <div className="field-hint">Shown on your PDF reports, under your name — not the work location below.</div>
        </div>
        <div className="field field-spaced weekly-cycle-field">
          <span className="weekly-cycle-eyebrow" aria-hidden="true">Weekly cycle</span>
          <label htmlFor="settings-week-start">Week starts on</label>
          <select
            id="settings-week-start"
            className="input"
            value={values.weekStartsOn}
            onChange={(event) => update({ weekStartsOn: event.target.value as WeekStart })}
            aria-describedby="settings-week-start-hint settings-week-range-hint"
          >
            {WEEK_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
          </select>
          <div id="settings-week-start-hint" className="field-hint">
            This determines your weekly cycle across earnings, goals, history, reports and spending.
          </div>
          <div id="settings-week-range-hint" className="field-hint">
            Your week runs {values.weekStartsOn} to {weekEndDay(values.weekStartsOn)}.
          </div>
        </div>

        <SettingsSaveBar saving={saving} dirty={dirty} success={success} error={error} onSave={handleSave} />
      </div>
      <ThemeSettings />
      <section className="card profile-layout-settings" aria-labelledby="profile-layout-title">
        <span className="profile-layout-settings-icon" aria-hidden="true"><SlidersIcon size={20} /></span>
        <div className="profile-layout-settings-copy">
          <span className="weekly-cycle-eyebrow">Personalisation</span>
          <h3 id="profile-layout-title">App layout</h3>
          <p>Reorder or hide Home widgets, and arrange the tab bar to match how you use the app.</p>
        </div>
        <button type="button" className="profile-layout-settings-action" onClick={() => setCustomizerOpen(true)} aria-haspopup="dialog">
          <span>Customise app layout</span><ChevronRightIcon size={17} />
        </button>
      </section>
      <ActiveShiftActivitySettings />
      {customizerOpen && <LayoutCustomizer onClose={() => setCustomizerOpen(false)} />}
    </>
  );
}
