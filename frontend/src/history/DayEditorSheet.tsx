import { useEffect, useMemo, useRef, useState } from "react";
import { Overlay } from "../components/Overlay";
import { AsyncButton } from "../components/AsyncButton";
import { StatusBanner } from "../components/StatusBanner";
import { CloseIcon } from "../components/icons";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
import { computeHours, fmt2, parseIsoDate } from "../lib/date";
import { describeShiftTimes, FUTURE_DATE_WARNING, isFutureDate, isUnusuallyLongShift, LONG_SHIFT_WARNING } from "../lib/shiftRules";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../components/ConfirmProvider";

export interface DayEditorTarget {
  dateISO: string;
}

interface DayEditorSheetProps {
  target: DayEditorTarget;
  onClose: () => void;
  onSave: (shiftId: string | null, values: { signIn: string; signOut: string; location: string; workLocationId: string | null; locationChanged: boolean; fuelCost: number | null; shiftChanged: boolean; fuelChanged: boolean; allowFutureDate: boolean }) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
}

/** A blank row is represented by `null` rather than by a synthetic shift, so
 * "which shift am I editing" has exactly one representation. */
type Selection = string | null;

function weekdayLabel(dateISO: string): string {
  return parseIsoDate(dateISO).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/**
 * Correcting one day of a completed week.
 *
 * A dialog rather than seven inline forms: History's job is to be scannable,
 * and a week card carrying seven editable rows stops being a summary. On a
 * phone this is a full-height sheet; from the tablet breakpoint up, a centred
 * modal. Both go through `<Overlay>`, which portals out of the swipe track's
 * transform — without that a fixed-position dialog is contained by the
 * track rather than the viewport and neither covers the header nor stays put
 * while the page behind scrolls.
 *
 * Sign-in and sign-out are the editable truth. Hours are shown but never
 * typed: they are derived everywhere else in the app (`computeHours`), and
 * letting someone overwrite a total directly would create a second, silently
 * conflicting source for the same number.
 */
export function DayEditorSheet({ target, onClose, onSave, onDelete }: DayEditorSheetProps) {
  const confirm = useConfirm();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { closing, requestClose } = useDismissTransition(220);

  // Read live from context rather than from a snapshot passed in at open
  // time. With a snapshot, `original` below would still hold the pre-save
  // values after a successful save, so `dirty` would never clear and the
  // form would claim unsaved changes for edits that had already landed.
  const { today, shifts, dayExpenses, workLocations } = useApp();
  const activeLocations = (workLocations ?? []).filter((item) => !item.archived);
  const dayShifts = useMemo(
    () => shifts.filter((s) => s.date === target.dateISO),
    [shifts, target.dateISO]
  );

  const [selectedId, setSelectedId] = useState<Selection>(dayShifts[0]?.id ?? null);
  const selected = dayShifts.find((s) => s.id === selectedId) ?? null;

  const [signIn, setSignIn] = useState(selected?.signIn ?? "");
  const [signOut, setSignOut] = useState(selected?.signOut ?? "");
  // Legacy shifts created before relational locations existed keep their
  // historical display name as the select value. That lets a user edit only
  // the time without being forced to rewrite history to a current branch.
  const [workLocationId, setWorkLocationId] = useState(selected?.workLocationId ?? selected?.location ?? (activeLocations.length === 1 ? activeLocations[0].id : ""));
  const originalFuelCost = dayExpenses.find((expense) => expense.date === target.dateISO)?.fuelCost ?? null;
  const [fuelCost, setFuelCost] = useState(originalFuelCost === null ? "" : String(originalFuelCost));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [futureDateAcknowledged, setFutureDateAcknowledged] = useState(false);

  useEffect(() => {
    setFutureDateAcknowledged(false);
  }, [target.dateISO]);

  // Switching between shifts on the same day reloads the form from that
  // shift. Keyed off the id so it doesn't fire on every render.
  // A newly created shift arrives in context after the save resolves; adopt
  // it as the selection so a second save edits it rather than creating
  // another one.
  useEffect(() => {
    if (selectedId === null && dayShifts.length > 0) setSelectedId(dayShifts[dayShifts.length - 1].id);
  }, [dayShifts, selectedId]);

  const loadedIdRef = useRef<Selection>(selectedId);
  useEffect(() => {
    if (loadedIdRef.current === selectedId) return;
    const wasBlank = loadedIdRef.current === null;
    loadedIdRef.current = selectedId;
    setSignIn(selected?.signIn ?? "");
    setSignOut(selected?.signOut ?? "");
    setWorkLocationId(selected?.workLocationId ?? selected?.location ?? (activeLocations.length === 1 ? activeLocations[0].id : ""));
    setError(null);
    // Moving from the blank state to a real id is this component adopting
    // the shift it just created, not the user picking a different shift — so
    // the confirmation from that save must survive. Clearing it here made
    // "Add hours" save successfully and then show nothing at all, which
    // reads as the save having silently failed.
    if (!wasBlank) setSaved(false);
  }, [selectedId, selected]);

  const original = useMemo(
    () => ({
      signIn: selected?.signIn ?? "",
      signOut: selected?.signOut ?? "",
      // A sole active branch is only a UI preselection for an empty day. It
      // must not make the form dirty or create a shift on its own.
      workLocationId: selected?.workLocationId
        ?? selected?.location
        ?? (activeLocations.length === 1 ? activeLocations[0].id : ""),
    }),
    [selected, workLocations]
  );
  const timeFieldsDirty = signIn !== original.signIn || signOut !== original.signOut;
  const shiftDirty = signIn !== original.signIn || signOut !== original.signOut || workLocationId !== original.workLocationId;
  const parsedFuelCost = fuelCost.trim() === "" ? null : Number(fuelCost);
  const fuelValid = parsedFuelCost === null || (
    Number.isFinite(parsedFuelCost)
    && parsedFuelCost >= 0
    && parsedFuelCost <= 10000
    && Math.abs(parsedFuelCost * 100 - Math.round(parsedFuelCost * 100)) < 1e-7
  );
  const normalisedFuelCost = parsedFuelCost && parsedFuelCost > 0 ? Math.round(parsedFuelCost * 100) / 100 : null;
  const fuelDirty = normalisedFuelCost !== originalFuelCost;
  const dirty = shiftDirty || fuelDirty;

  // Live, read-only. Recomputed with the same function every total in the app
  // uses, so the preview cannot disagree with what saving will produce.
  const previewHours = signIn && signOut ? computeHours(signIn, signOut) : 0;
  const futureDate = isFutureDate(target.dateISO, today);
  // Keep the inline validation focused on malformed times. A future date is
  // deliberately a confirmable warning, not a permanently disabled form.
  const validation = describeShiftTimes(target.dateISO, signIn || null, signOut || null, true, today);
  const selectedActiveLocation = activeLocations.find((item) => item.id === workLocationId);
  const canSave = dirty && !saving && fuelValid && (
    !shiftDirty
    || (!!signIn && !!signOut && validation === null && (!!selected || !!selectedActiveLocation))
  );

  function close() {
    if (saving || deleting) return;
    requestClose(onClose);
  }

  // Escape and the backdrop both route through here, so unsaved work gets the
  // same confirmation whichever way the dialog is dismissed.
  function attemptClose() {
    if (saving || deleting) return;
    if (dirty && !window.confirm("Discard your unsaved changes to this day?")) return;
    close();
  }

  useFocusTrap(true, attemptClose, closeButtonRef);

  // A tab close or reload with unsaved edits gets the browser's own prompt.
  // Only while genuinely dirty — an always-on handler makes every navigation
  // ask, which trains people to dismiss it without reading.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function handleSave() {
    if (!canSave) return;
    let allowFutureDate = false;
    if (futureDate && !futureDateAcknowledged) {
      const accepted = await confirm(`${FUTURE_DATE_WARNING}\n\nDate: ${weekdayLabel(target.dateISO)}.`, "danger");
      if (!accepted) return;
      setFutureDateAcknowledged(true);
      allowFutureDate = true;
    } else if (futureDate) {
      allowFutureDate = true;
    }
    if (timeFieldsDirty && isUnusuallyLongShift(signIn, signOut) && !(await confirm(LONG_SHIFT_WARNING))) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const selectedLocation = activeLocations.find((item) => item.id === workLocationId);
      await onSave(selectedId, {
        signIn,
        signOut,
        location: selectedLocation?.name ?? selected?.location ?? "",
        workLocationId: selectedLocation?.id ?? selected?.workLocationId ?? null,
        locationChanged: workLocationId !== original.workLocationId,
        fuelCost: normalisedFuelCost,
        shiftChanged: shiftDirty,
        fuelChanged: fuelDirty,
        allowFutureDate,
      });
      setSaved(true);
      // Deliberately does NOT close or clear the fields. The values stay on
      // screen so the result is visible, and so a subsequent failure never
      // finds an empty form to fail against.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this change");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(selectedId);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this entry");
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <Overlay>
      <div className={`day-editor-backdrop${closing ? " is-closing" : ""}`} onClick={attemptClose}>
        <div
          className={`day-editor${closing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="day-editor-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="day-editor-grabber" aria-hidden="true" />

          <div className="day-editor-head">
            <div className="day-editor-heading">
              <h2 id="day-editor-title" className="day-editor-title">
                {dayShifts.length > 0 ? "Edit hours" : "Add hours"}
              </h2>
              <p className="section-hint day-editor-date">{weekdayLabel(target.dateISO)}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="btn btn-ghost day-editor-icon-btn"
              onClick={attemptClose}
              aria-label="Close without saving"
            >
              <CloseIcon size={16} />
            </button>
          </div>

          <div className="day-editor-body">
            {error && <StatusBanner tone="danger">{error}</StatusBanner>}
            {saved && !error && !dirty && <StatusBanner tone="success">Saved</StatusBanner>}

            {/* Only shown when the day genuinely has more than one shift.
                The model allows it and Entry creates them, so the editor has
                to say which one it is changing rather than silently picking
                the first. */}
            {dayShifts.length > 1 && (
              <fieldset className="fieldset-plain day-editor-picker">
                <legend className="day-editor-picker-legend">Which shift?</legend>
                <div className="seg day-editor-seg">
                  {dayShifts.map((s, i) => (
                    <label className="seg-opt" key={s.id}>
                      <input
                        type="radio"
                        name="day-editor-shift"
                        checked={selectedId === s.id}
                        onChange={() => setSelectedId(s.id)}
                      />
                      {s.signIn && s.signOut ? `${s.signIn}–${s.signOut}` : `Shift ${i + 1}`}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="day-editor-times">
              <div className="field">
                <label htmlFor="day-editor-signin">Sign in</label>
                <input
                  id="day-editor-signin"
                  className="input"
                  type="time"
                  value={signIn}
                  onChange={(e) => {
                    setSignIn(e.target.value);
                    setSaved(false);
                  }}
                  disabled={busy}
                  aria-invalid={validation ? true : undefined}
                  aria-describedby="day-editor-hours"
                />
              </div>
              <div className="field">
                <label htmlFor="day-editor-signout">Sign out</label>
                <input
                  id="day-editor-signout"
                  className="input"
                  type="time"
                  value={signOut}
                  onChange={(e) => {
                    setSignOut(e.target.value);
                    setSaved(false);
                  }}
                  disabled={busy}
                  aria-invalid={validation ? true : undefined}
                  aria-describedby="day-editor-hours"
                />
              </div>
            </div>

            <div className="field day-editor-location-field">
              <label htmlFor="day-editor-location">Location</label>
              <select
                id="day-editor-location"
                className="input"
                value={workLocationId}
                onChange={(e) => {
                  setWorkLocationId(e.target.value);
                  setSaved(false);
                }}
                disabled={busy}
              >
                <option value="">Choose a location</option>
                {selected?.location && !selected.workLocationId && (
                  <option value={selected.location}>{selected.location} (historical)</option>
                )}
                {selected?.workLocationId && !activeLocations.some((item) => item.id === selected.workLocationId) && (
                  <option value={selected.workLocationId}>{selected.location} (archived)</option>
                )}
                {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </div>

            <div className="field day-editor-fuel-field">
              <label htmlFor="day-editor-fuel">Fuel allowance override</label>
              <div className="day-editor-money-input">
                <span aria-hidden="true">$</span>
                <input
                  id="day-editor-fuel"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="10000"
                  step="0.01"
                  placeholder="0.00"
                  value={fuelCost}
                  onChange={(e) => { setFuelCost(e.target.value); setSaved(false); }}
                  disabled={busy}
                  aria-invalid={!fuelValid || undefined}
                  aria-describedby="day-editor-fuel-hint"
                />
              </div>
              <span id="day-editor-fuel-hint" className={`field-hint${fuelValid ? "" : " field-hint-danger"}`}>
                {fuelValid ? "Optional. Leave blank to restore the automatic branch allowance." : "Enter an amount from $0 to $10,000 using no more than two decimal places."}
              </span>
            </div>

            {/* aria-live so the recomputed figure is announced as the times
                change, rather than being a number only sighted users get. */}
            <div className="day-editor-hours" id="day-editor-hours" role="status" aria-live="polite">
              <span className="day-editor-hours-label">Calculated hours</span>
              <strong className="day-editor-hours-value">{signIn && signOut ? `${fmt2(previewHours)}h` : "—"}</strong>
            </div>

            {validation && (
              <p className="field-hint field-hint-danger day-editor-validation" role="alert">
                {validation}
              </p>
            )}
            {!validation && isUnusuallyLongShift(signIn, signOut) && (
              <StatusBanner tone="warning" className="day-editor-long-warning">
                {LONG_SHIFT_WARNING}
              </StatusBanner>
            )}
            {futureDate && !futureDateAcknowledged && (
              <StatusBanner tone="warning" className="day-editor-future-warning">
                This is a future date. Saving will add the hours and fuel to your reports before the work happens; Save will ask you to confirm.
              </StatusBanner>
            )}
            {signIn && signOut && !validation && computeHours(signIn, signOut) > 0 && signOut < signIn && (
              <p className="field-hint day-editor-overnight">
                Sign-out is earlier than sign-in, so this is counted as an overnight shift ending the next day.
              </p>
            )}
          </div>

          <div className="day-editor-actions">
            <div className="day-editor-actions-main">
              <button type="button" className="btn btn-secondary" onClick={attemptClose} disabled={busy}>
                Cancel
              </button>
              <AsyncButton type="button" className="btn btn-primary" onClick={handleSave} disabled={!canSave && !saving} busy={saving} idleLabel="Save" busyLabel="Saving…" />
            </div>
            {selectedId && (
              // Separated from Save/Cancel by a rule, and never adjacent to
              // the primary action — removing a day's record is not a
              // variation on saving it.
              <AsyncButton
                type="button"
                className="btn btn-danger day-editor-delete"
                onClick={handleDelete}
                disabled={busy && !deleting}
                busy={deleting}
                idleLabel="Remove this entry"
                busyLabel="Removing…"
                data-confirm="Remove this entry? The hours will be taken off this week's totals."
                data-confirm-tone="danger"
              />
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
