import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { useDirtyForm } from "../lib/useDirtyForm";
import { parseNumberField } from "../lib/numberField";
import { SettingsSaveBar } from "./SettingsSaveBar";

interface WorkPayDraft {
  workLocationName: string;
  workAddress: string;
  multipleLocations: boolean;
  otherLocations: string;
  rateRaw: string;
}

export function WorkPaySettings() {
  const { user, updateSettings } = useApp();
  const { values, setValues, dirty, markSaved } = useDirtyForm<WorkPayDraft>({
    workLocationName: user?.workLocationName ?? "",
    workAddress: user?.workAddress ?? "",
    multipleLocations: user?.multipleLocations ?? false,
    otherLocations: user?.otherLocations ?? "",
    rateRaw: user?.rate ? String(user.rate) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) return null;

  const rateField = parseNumberField(values.rateRaw as string, { min: 0, max: 1000 });

  function update(patch: Partial<WorkPayDraft>) {
    setValues({ ...values, ...patch });
    setSuccess(false);
  }

  async function handleSave() {
    if (!rateField.valid) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateSettings({
        workLocationName: values.workLocationName as string,
        workAddress: values.workAddress as string,
        multipleLocations: values.multipleLocations as boolean,
        otherLocations: values.otherLocations as string,
        rate: rateField.value,
      });
      markSaved(values);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your work details. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-section-card card">
      <div className="field field-spaced">
        <label htmlFor="settings-work-location">Work location name</label>
        <input
          id="settings-work-location"
          className="input"
          type="text"
          placeholder="Downtown Store"
          value={values.workLocationName as string}
          onChange={(e) => update({ workLocationName: e.target.value })}
        />
      </div>
      <div className="field field-spaced">
        <label htmlFor="settings-work-address">Work address</label>
        <input
          id="settings-work-address"
          className="input"
          type="text"
          placeholder="123 Main St, Springfield"
          value={values.workAddress as string}
          onChange={(e) => update({ workAddress: e.target.value })}
        />
      </div>
      <fieldset className="fieldset-plain field field-spaced">
        <legend>Do you work multiple locations?</legend>
        <div className="seg">
          <label className="seg-opt">
            <input
              type="radio"
              name="multiloc-s"
              checked={!values.multipleLocations}
              onChange={() => update({ multipleLocations: false })}
            />
            No
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="multiloc-s"
              checked={!!values.multipleLocations}
              onChange={() => update({ multipleLocations: true })}
            />
            Yes
          </label>
        </div>
      </fieldset>
      {values.multipleLocations && (
        <div className="field field-spaced">
          <label htmlFor="settings-other-locations">Other locations</label>
          <input
            id="settings-other-locations"
            className="input"
            type="text"
            placeholder="e.g. Uptown Branch, Airport Kiosk"
            value={values.otherLocations as string}
            onChange={(e) => update({ otherLocations: e.target.value })}
          />
        </div>
      )}
      <div className="field field-spaced">
        <label htmlFor="settings-rate">Hourly rate ({CURRENCY})</label>
        <input
          id="settings-rate"
          className="input"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 25.00"
          value={values.rateRaw as string}
          onChange={(e) => update({ rateRaw: e.target.value })}
          aria-invalid={!rateField.valid}
          aria-describedby={!rateField.valid ? "settings-rate-error" : undefined}
        />
        {!rateField.valid && (
          <div id="settings-rate-error" className="field-hint field-hint-danger">
            {rateField.error}
          </div>
        )}
      </div>

      <SettingsSaveBar saving={saving} dirty={dirty} success={success} error={error} onSave={handleSave} disabled={!rateField.valid} />
    </div>
  );
}
