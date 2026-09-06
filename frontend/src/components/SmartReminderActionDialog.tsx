import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { findOpenShift } from "../lib/aggregate";
import { isoDate, nowHHMMSS } from "../lib/date";
import type { Screen } from "../lib/types";
import { endActiveShiftActivity } from "../platform/activeShiftActivity";
import { useFocusTrap } from "../lib/useFocusTrap";
import { LocationPinIcon, SmartBellIcon } from "./icons";

export function SmartReminderActionDialog({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const {
    pendingSmartReminderAction: action,
    dismissPendingSmartReminderAction,
    today,
    shifts = [],
    workLocations = [],
    createShift,
    clockOutShift,
    user,
  } = useApp();
  const activeLocations = useMemo(
    () => workLocations.filter((location) => !location.archived),
    [workLocations]
  );
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(!!action, undefined, confirmRef);
  const openShift = findOpenShift(shifts);

  useEffect(() => {
    if (!action) return;
    setLocationId(activeLocations.length === 1 ? activeLocations[0].id : "");
    setError(null);
    setBusy(false);
  }, [action?.reminderId, activeLocations]);

  useEffect(() => {
    if (!action) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) dismissPendingSmartReminderAction();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action, busy, dismissPendingSmartReminderAction]);

  if (!action) return null;

  const signingOut = action.kind === "signOut";
  const requestedShiftIsCurrent = !!openShift && (!action.shiftId || action.shiftId === openShift.id);
  const wrongAccount = action.accountId !== user?.id;
  const alreadyHandled = wrongAccount || (signingOut ? !requestedShiftIsCurrent : !!openShift);
  const chosenLocation = activeLocations.find((location) => location.id === locationId);
  const canConfirm = !alreadyHandled && (signingOut || !!chosenLocation) && !busy;

  async function confirmAction() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      if (signingOut) {
        if (!openShift) return;
        const result = await clockOutShift(openShift.id, nowHHMMSS());
        if (!result) throw new Error("Your shift couldn't be ended. Check your connection and try again.");
        await endActiveShiftActivity({
          shiftId: result.shift.id,
          finalDurationSeconds: result.finalDurationSeconds,
        });
      } else {
        if (!chosenLocation) return;
        const shift = await createShift({
          date: isoDate(today),
          workLocationId: chosenLocation.id,
          location: chosenLocation.name,
          signIn: nowHHMMSS(),
          signOut: null,
        });
        if (!shift) throw new Error("Your shift couldn't be started. Check your connection and try again.");
      }
      dismissPendingSmartReminderAction();
      onNavigate("entry");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That action couldn't be completed. Try again.");
      setBusy(false);
    }
  }

  const stateMessage = wrongAccount
    ? "This reminder belongs to a different signed-in account, so no shift can be changed."
    : alreadyHandled
    ? signingOut
      ? "This shift has already ended. Your saved times are unchanged."
      : "A shift is already active, so no second shift will be started."
    : signingOut
      ? `Your ${openShift?.location || "current"} shift will end at the current time. This cannot happen until you confirm below.`
      : "Choose where you're working, then confirm. Nothing changes from tapping the notification alone.";

  return (
    <div className="confirm-backdrop smart-reminder-action-backdrop" onClick={() => !busy && dismissPendingSmartReminderAction()}>
      <div
        ref={trapRef}
        className="confirm-modal smart-reminder-action-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="smart-reminder-action-title"
        aria-describedby="smart-reminder-action-description"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`smart-reminder-action-icon${signingOut ? " is-signout" : ""}`} aria-hidden="true">
          <SmartBellIcon size={25} />
        </div>
        <span className="weekly-cycle-eyebrow">Smart reminder</span>
        <h2 id="smart-reminder-action-title">
          {alreadyHandled ? "You're already up to date" : signingOut ? "Finish your shift?" : "Ready to sign in?"}
        </h2>
        {action.usualTimeLabel && (
          <div className="smart-reminder-action-usual">
            <span>Usual {signingOut ? "finish" : "start"}</span>
            <strong>{action.usualTimeLabel}</strong>
          </div>
        )}
        <p id="smart-reminder-action-description">{stateMessage}</p>

        {!signingOut && !alreadyHandled && activeLocations.length > 0 && (
          <label className="smart-reminder-location-field">
            <span><LocationPinIcon size={15} /> Work location</span>
            <select className="input" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Select a location</option>
              {activeLocations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
        )}
        {!signingOut && !alreadyHandled && activeLocations.length === 0 && (
          <p className="settings-error">Add an active work location before signing in.</p>
        )}
        {error && <p className="settings-error" role="alert">{error}</p>}

        <div className="dialog-actions smart-reminder-action-buttons">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={dismissPendingSmartReminderAction}>
            {alreadyHandled ? "Close" : "Not now"}
          </button>
          {!alreadyHandled && (
            <button
              ref={confirmRef}
              type="button"
              className={`btn ${signingOut ? "btn-danger" : "btn-primary"}`}
              disabled={!canConfirm}
              aria-busy={busy || undefined}
              onClick={() => void confirmAction()}
            >
              {busy ? (signingOut ? "Signing out…" : "Signing in…") : `Confirm ${signingOut ? "Sign Out" : "Sign In"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
