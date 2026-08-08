import { useState } from "react";
import { useApp } from "../context/AppContext";
import { useDirtyForm } from "../lib/useDirtyForm";
import type { WeekStart } from "../lib/types";
import { SettingsSaveBar } from "./SettingsSaveBar";

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
      <fieldset className="fieldset-plain field field-spaced">
        <legend>Week starts on</legend>
        <div className="seg">
          <label className="seg-opt">
            <input
              type="radio"
              name="weekstart"
              checked={values.weekStartsOn === "Monday"}
              onChange={() => update({ weekStartsOn: "Monday" })}
            />
            Monday
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="weekstart"
              checked={values.weekStartsOn === "Sunday"}
              onChange={() => update({ weekStartsOn: "Sunday" })}
            />
            Sunday
          </label>
        </div>
      </fieldset>

      <SettingsSaveBar saving={saving} dirty={dirty} success={success} error={error} onSave={handleSave} />
    </div>
  );
}
