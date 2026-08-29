import { useMemo, useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { parseNumberField } from "../lib/numberField";
import type { WorkLocation } from "../lib/types";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { AsyncButton } from "../components/AsyncButton";

interface LocationDraft {
  id: string | null;
  name: string;
  address: string;
  fuelEnabled: boolean;
  fuelAllowanceRaw: string;
}

const EMPTY_LOCATION: LocationDraft = { id: null, name: "", address: "", fuelEnabled: false, fuelAllowanceRaw: "" };

function fuelAllowanceError(enabled: boolean, raw: string): string | null {
  if (!enabled) return null;
  if (!raw.trim()) return "Enter the fuel allowance for this branch.";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a valid fuel allowance.";
  if (value <= 0) return "Fuel allowance must be greater than zero.";
  if (value > 10_000) return "Fuel allowance cannot exceed $10,000.";
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) return "Use no more than two decimal places.";
  return null;
}

export function WorkPaySettings() {
  const {
    user,
    updateSettings,
    workLocations,
    workLocationsLoading,
    createWorkLocation,
    updateWorkLocation,
    archiveWorkLocation,
  } = useApp();
  const [rateRaw, setRateRaw] = useState(user?.rate ? String(user.rate) : "");
  const [savedRate, setSavedRate] = useState(rateRaw);
  const [savingRate, setSavingRate] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSuccess, setRateSuccess] = useState(false);
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationBusyTarget, setLocationBusyTarget] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  const activeLocations = useMemo(() => (workLocations ?? []).filter((location) => !location.archived), [workLocations]);
  const archivedLocations = useMemo(() => (workLocations ?? []).filter((location) => location.archived), [workLocations]);

  if (!user) return null;

  const rateField = parseNumberField(rateRaw, { min: 0.01, max: 1000 });
  const rateDecimalsValid = rateField.valid
    && Math.abs(rateField.value * 100 - Math.round(rateField.value * 100)) < 1e-7;
  const rateValid = rateField.valid && rateDecimalsValid;
  const displayedRateError = !rateField.valid
    ? rateField.error
    : !rateDecimalsValid
      ? "Use no more than two decimal places."
      : null;
  const fuelError = draft ? fuelAllowanceError(draft.fuelEnabled, draft.fuelAllowanceRaw) : null;
  const locationValid = !!draft?.name.trim() && !fuelError;

  function startEditing(location: WorkLocation) {
    setDraft({
      id: location.id,
      name: location.name,
      address: location.address,
      fuelEnabled: location.fuelAllowance != null,
      fuelAllowanceRaw: location.fuelAllowance == null ? "" : String(location.fuelAllowance),
    });
    setLocationError(null);
    setLocationMessage(null);
  }

  async function saveLocation() {
    if (!draft || !locationValid) return;
    setLocationBusy(true);
    setLocationBusyTarget(draft.id ? `save:${draft.id}` : "save:new");
    setLocationError(null);
    setLocationMessage(null);
    const fuelAllowance = draft.fuelEnabled ? Number(draft.fuelAllowanceRaw) : null;
    try {
      if (draft.id) {
        await updateWorkLocation(draft.id, { name: draft.name, address: draft.address, fuelAllowance });
        setLocationMessage("Work location updated.");
      } else {
        await createWorkLocation({ name: draft.name, address: draft.address, fuelAllowance });
        setLocationMessage("Work location added.");
      }
      setDraft(null);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Couldn't save the work location.");
    } finally {
      setLocationBusy(false);
      setLocationBusyTarget(null);
    }
  }

  async function confirmArchive(location: WorkLocation) {
    if (!window.confirm(`Archive ${location.name}? Existing shifts and reports will keep their historical name and allowance.`)) return;
    setLocationBusy(true);
    setLocationBusyTarget(`archive:${location.id}`);
    setLocationError(null);
    try {
      await archiveWorkLocation(location.id);
      if (draft?.id === location.id) setDraft(null);
      setLocationMessage(`${location.name} archived.`);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Couldn't archive the work location.");
    } finally {
      setLocationBusy(false);
      setLocationBusyTarget(null);
    }
  }

  async function restoreLocation(location: WorkLocation) {
    setLocationBusy(true);
    setLocationBusyTarget(`restore:${location.id}`);
    setLocationError(null);
    try {
      await updateWorkLocation(location.id, { archived: false });
      setLocationMessage(`${location.name} restored.`);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Couldn't restore the work location.");
    } finally {
      setLocationBusy(false);
      setLocationBusyTarget(null);
    }
  }

  async function saveRate() {
    if (!rateValid) return;
    setSavingRate(true);
    setRateError(null);
    setRateSuccess(false);
    try {
      await updateSettings({ rate: rateField.value });
      setSavedRate(rateRaw);
      setRateSuccess(true);
    } catch (error) {
      setRateError(error instanceof Error ? error.message : "Couldn't save your hourly rate.");
    } finally {
      setSavingRate(false);
    }
  }

  return (
    <div className="settings-section-card card work-pay-settings">
      <section aria-labelledby="work-locations-heading">
        <div className="settings-subsection-head">
          <div>
            <h3 id="work-locations-heading">Which branches or work locations do you work at?</h3>
            <p className="field-hint">Choose a branch on each shift. Allowances are snapshotted so later edits never alter history.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => { setDraft({ ...EMPTY_LOCATION }); setLocationError(null); setLocationMessage(null); }} disabled={locationBusy}>
            Add location
          </button>
        </div>

        {workLocationsLoading ? (
          <p className="settings-empty-state">Loading work locations…</p>
        ) : activeLocations.length === 0 ? (
          <div className="settings-empty-state" role="status">No active work locations yet. Add your first branch to enable branch selection and automatic fuel allowance.</div>
        ) : (
          <div className="work-location-list">
            {activeLocations.map((location) => (
              <article className="work-location-card" key={location.id}>
                <div>
                  <strong>{location.name}</strong>
                  {location.address && <div className="field-hint">{location.address}</div>}
                  <div className="field-hint">{location.fuelAllowance == null ? "No automatic fuel allowance" : `${CURRENCY}${location.fuelAllowance.toFixed(2)} per worked day`}</div>
                </div>
                <div className="work-location-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => startEditing(location)} disabled={locationBusy}>Edit</button>
                  <AsyncButton type="button" className="btn btn-danger" onClick={() => void confirmArchive(location)} disabled={locationBusy && locationBusyTarget !== `archive:${location.id}`} busy={locationBusyTarget === `archive:${location.id}`} idleLabel="Archive" busyLabel="Archiving…" />
                </div>
              </article>
            ))}
          </div>
        )}

        {draft && (
          <div className="work-location-editor" role="group" aria-labelledby="location-editor-heading">
            <h4 id="location-editor-heading">{draft.id ? "Edit work location" : "Add work location"}</h4>
            <div className="field field-spaced">
              <label htmlFor="work-location-name">Location name</label>
              <input id="work-location-name" className="input" value={draft.name} maxLength={120} required onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <div className="field field-spaced">
              <label htmlFor="work-location-address">Address <span className="field-optional">Optional</span></label>
              <input id="work-location-address" className="input" value={draft.address} maxLength={300} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
            </div>
            <div className="field field-spaced">
              <label className="checkbox work-location-fuel-toggle">
                <input
                  type="checkbox"
                  checked={draft.fuelEnabled}
                  onChange={(event) => setDraft({
                    ...draft,
                    fuelEnabled: event.target.checked,
                    fuelAllowanceRaw: event.target.checked ? draft.fuelAllowanceRaw : "",
                  })}
                />
                <span className="box" />
                Do you receive a fuel allowance when working at this branch?
              </label>
              {draft.fuelEnabled ? <>
                <label htmlFor="work-location-fuel">Fuel allowance per worked day ({CURRENCY})</label>
                <input id="work-location-fuel" className="input" type="text" inputMode="decimal" placeholder="e.g. 15.00" value={draft.fuelAllowanceRaw} aria-invalid={fuelError ? true : undefined} aria-describedby={fuelError ? "work-location-fuel-error" : "work-location-fuel-hint"} onChange={(event) => setDraft({ ...draft, fuelAllowanceRaw: event.target.value })} />
                {fuelError ? <div id="work-location-fuel-error" className="field-hint field-hint-danger">{fuelError}</div> : <div id="work-location-fuel-hint" className="field-hint">Added to earnings once per branch on each date that has a saved worked shift.</div>}
              </> : <div className="field-hint">No fuel allowance will be added for this branch. You can enable it later.</div>}
            </div>
            <div className="work-location-actions">
              <AsyncButton type="button" className="btn btn-primary" onClick={() => void saveLocation()} disabled={!locationValid || (locationBusy && !locationBusyTarget?.startsWith("save:"))} busy={Boolean(locationBusyTarget?.startsWith("save:"))} idleLabel="Save location" busyLabel="Saving…" />
              <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)} disabled={locationBusy}>Cancel</button>
            </div>
          </div>
        )}

        {archivedLocations.length > 0 && (
          <details className="archived-locations">
            <summary>Archived locations ({archivedLocations.length})</summary>
            <div className="work-location-list">
              {archivedLocations.map((location) => (
                <article className="work-location-card is-archived" key={location.id}>
                  <div><strong>{location.name}</strong><div className="field-hint">Hidden from new shifts; historical records are unchanged.</div></div>
                  <AsyncButton type="button" className="btn btn-secondary" onClick={() => void restoreLocation(location)} disabled={locationBusy && locationBusyTarget !== `restore:${location.id}`} busy={locationBusyTarget === `restore:${location.id}`} idleLabel="Restore" busyLabel="Restoring…" />
                </article>
              ))}
            </div>
          </details>
        )}
        <div className="settings-inline-status" aria-live="polite">
          {locationError && <div className="settings-error">{locationError}</div>}
          {locationMessage && <div className="settings-success">{locationMessage}</div>}
        </div>
      </section>

      <hr className="settings-divider" />

      <section aria-labelledby="hourly-rate-heading">
        <h3 id="hourly-rate-heading">Hourly pay</h3>
        <div className="field field-spaced">
          <label htmlFor="settings-rate">Hourly rate ({CURRENCY})</label>
          <input id="settings-rate" className="input" type="text" inputMode="decimal" placeholder="e.g. 25.00" value={rateRaw} onChange={(event) => { setRateRaw(event.target.value); setRateSuccess(false); }} aria-invalid={!rateValid} aria-describedby={!rateValid ? "settings-rate-error" : undefined} />
          {!rateValid && <div id="settings-rate-error" className="field-hint field-hint-danger">{displayedRateError}</div>}
        </div>
        <SettingsSaveBar saving={savingRate} dirty={rateRaw !== savedRate} success={rateSuccess} error={rateError} onSave={saveRate} disabled={!rateValid} />
      </section>
    </div>
  );
}
