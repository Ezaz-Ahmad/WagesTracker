import { useId, useState } from "react";
import { useApp } from "../context/AppContext";
import { parseNumberField } from "../lib/numberField";
import { SettingsSaveBar } from "./SettingsSaveBar";

/** During a rolling deployment an older API advertises no workspace support.
 * Keep its existing account-rate flow usable until that API is replaced. */
export function LegacyHourlyPay() {
  const { user, updateSettings } = useApp();
  const id = useId();
  const [raw, setRaw] = useState(String(user?.rate || "")),
    [saved, setSaved] = useState(raw),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [success, setSuccess] = useState(false);
  const field = parseNumberField(raw, { min: 0.01, max: 1000 }),
    valid =
      field.valid &&
      Math.abs(field.value * 100 - Math.round(field.value * 100)) < 1e-7;
  return (
    <section className="card settings-section-card">
      <h3>Hourly pay</h3>
      <label className="field field-spaced" htmlFor={id}>
        Hourly rate (AUD)
        <input
          id={id}
          className="input"
          type="text"
          inputMode="decimal"
          value={raw}
          aria-invalid={!valid}
          onChange={(e) => {
            setRaw(e.target.value);
            setSuccess(false);
          }}
        />
      </label>
      {!valid && (
        <p className="field-hint field-hint-danger">
          {field.error || "Use no more than two decimal places."}
        </p>
      )}
      <SettingsSaveBar
        dirty={saved !== raw}
        saving={busy}
        success={success}
        error={error}
        disabled={!valid}
        onSave={() => {
          setBusy(true);
          setError(null);
          void updateSettings({ rate: Number(raw) })
            .then(() => {
              setSaved(raw);
              setSuccess(true);
            })
            .catch((e) =>
              setError(
                e instanceof Error ? e.message : "Couldn't save hourly pay"
              )
            )
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}
