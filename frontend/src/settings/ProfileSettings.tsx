import { useState } from "react";
import { useApp } from "../context/AppContext";
import { useDirtyForm } from "../lib/useDirtyForm";
import type { WeekStart } from "../lib/types";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { WEEK_DAYS, weekEndDay } from "../lib/weekBoundary.mjs";
import { ActiveShiftActivitySettings } from "./ActiveShiftActivitySettings";
import { LayoutCustomizer } from "../components/LayoutCustomizer";
import { ChevronRightIcon, SlidersIcon, UserIcon } from "../components/icons";
import { ThemeSettings } from "./ThemeSettings";
import { SmartShiftReminderSettings } from "./SmartShiftReminderSettings";

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

  const initials = values.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "WT";

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
      <div className="profile-settings-stack">
        <section className="settings-section-card card profile-details-settings" aria-labelledby="profile-details-title">
          <div className="profile-details-heading">
            <span className="profile-details-avatar" aria-hidden="true">
              <UserIcon size={18} />
              <strong>{initials}</strong>
            </span>
            <div>
              <span className="weekly-cycle-eyebrow">Personal details</span>
              <h3 id="profile-details-title">Your profile</h3>
              <p>Keep the details used across your account and reports up to date.</p>
            </div>
          </div>

          <div className="profile-details-fields">
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
                aria-describedby="settings-address-hint"
              />
              <div id="settings-address-hint" className="field-hint">Used on your PDF reports.</div>
            </div>
          </div>

          <div className="field field-spaced weekly-cycle-field">
            <span className="weekly-cycle-eyebrow" aria-hidden="true">Weekly cycle</span>
            <label htmlFor="settings-week-start">Week starts on</label>
            <select
              id="settings-week-start"
              className="input"
              value={values.weekStartsOn}
              onChange={(event) => update({ weekStartsOn: event.target.value as WeekStart })}
              aria-describedby="settings-week-range-hint"
            >
              {WEEK_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
            <div id="settings-week-range-hint" className="field-hint">
              Your earnings, goals and reports will run {values.weekStartsOn} to {weekEndDay(values.weekStartsOn)}.
            </div>
          </div>

          <SettingsSaveBar saving={saving} dirty={dirty} success={success} error={error} onSave={handleSave} />
        </section>

        <SmartShiftReminderSettings />
        <ThemeSettings />
        <section className="card profile-layout-settings" aria-labelledby="profile-layout-title">
          <span className="profile-layout-settings-icon" aria-hidden="true"><SlidersIcon size={20} /></span>
          <div className="profile-layout-settings-copy">
            <span className="weekly-cycle-eyebrow">Make it yours</span>
            <h3 id="profile-layout-title">App layout</h3>
            <p>Choose what appears on Home and arrange the tab bar around the way you work.</p>
          </div>
          <button type="button" className="profile-layout-settings-action" onClick={() => setCustomizerOpen(true)} aria-haspopup="dialog">
            <span>Customise app layout</span><ChevronRightIcon size={17} />
          </button>
        </section>
        <ActiveShiftActivitySettings />
      </div>
      {customizerOpen && <LayoutCustomizer onClose={() => setCustomizerOpen(false)} />}
    </>
  );
}
