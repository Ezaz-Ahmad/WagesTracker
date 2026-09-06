import { useState } from "react";
import { SmartBellIcon } from "../components/icons";
import { useApp } from "../context/AppContext";
import { formatReminderTime } from "../lib/smartShiftReminders";
import { isSmartShiftReminderNotificationsConfigured } from "../platform/smartShiftReminderNotifications";

export function SmartShiftReminderSettings() {
  const {
    user,
    smartReminderPatterns,
    smartReminderAuthorization,
    smartReminderScheduledCount,
    setSmartRemindersEnabled,
  } = useApp();
  // Several isolated Settings tests provide only the fields relevant to the
  // panel they exercise. Runtime AppProvider always supplies these values;
  // the fallbacks keep this leaf component equally harmless in isolation.
  const patterns = smartReminderPatterns ?? [];
  const authorization = smartReminderAuthorization ?? "unavailable";
  const scheduledCount = smartReminderScheduledCount ?? 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = !!user?.smartRemindersEnabled;
  const native = isSmartShiftReminderNotificationsConfigured();

  if (!user) return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setSmartRemindersEnabled?.(!enabled);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't update smart reminders. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const status = !enabled
    ? "Off — your history is never used for reminders"
    : authorization === "denied"
      ? "On, but notifications are blocked in iOS Settings"
      : patterns.length === 0
        ? "Learning quietly — no reliable weekday pattern yet"
        : native
          ? `${patterns.length} reliable ${patterns.length === 1 ? "routine" : "routines"} learned · ${scheduledCount} upcoming ${scheduledCount === 1 ? "alert" : "alerts"}`
          : `${patterns.length} reliable ${patterns.length === 1 ? "routine" : "routines"} learned · alerts will be delivered by the iPhone app`;

  return (
    <section className={`card smart-reminder-settings${enabled ? " is-enabled" : ""}`} aria-labelledby="smart-reminder-title">
      <div className="smart-reminder-glow" aria-hidden="true" />
      <div className="smart-reminder-head">
        <span className="smart-reminder-icon" aria-hidden="true"><SmartBellIcon size={22} /></span>
        <div className="smart-reminder-heading-copy">
          <span className="weekly-cycle-eyebrow">Personalised assistance</span>
          <h3 id="smart-reminder-title">Smart shift reminders</h3>
          <p>
            Learns only from consistent, completed shifts and gently checks in when a usual start or finish appears to be missed.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-describedby="smart-reminder-description smart-reminder-status"
          aria-label="Smart shift reminders"
          className={`settings-switch smart-reminder-switch${enabled ? " is-on" : ""}`}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <span className="settings-switch-track" aria-hidden="true"><span className="settings-switch-thumb" /></span>
          <span className="settings-switch-state" aria-hidden="true">{busy ? "Saving…" : enabled ? "On" : "Off"}</span>
        </button>
      </div>

      <p id="smart-reminder-description" className="visually-hidden">
        Requires at least four consistent completed shifts for a weekday. Manually corrected, unusual and split shifts are ignored.
      </p>

      <div className="smart-reminder-status-row" id="smart-reminder-status" role="status">
        <span className={`smart-reminder-status-dot${enabled ? " is-live" : ""}`} aria-hidden="true" />
        <span>{status}</span>
      </div>

      {enabled && patterns.length > 0 && (
        <div className="smart-reminder-routines" aria-label="Reliable shift routines">
          {patterns.map((pattern) => (
            <div className="smart-reminder-routine" key={pattern.weekday}>
              <span>{pattern.weekdayName.slice(0, 3)}</span>
              <strong>{formatReminderTime(pattern.usualStartMinutes)}</strong>
              <i aria-hidden="true">→</i>
              <strong>{formatReminderTime(pattern.usualEndOffsetMinutes)}</strong>
              <small>{pattern.sampleSize} shifts</small>
            </div>
          ))}
        </div>
      )}

      <div className="smart-reminder-guardrails" aria-label="Smart reminder safeguards">
        <span>20-min grace</span>
        <span>Reliable patterns only</span>
        <span>No automatic clocking</span>
      </div>

      <p className="smart-reminder-footnote">
        Missed alerts are sent once, include Sign In or Sign Out, Remind Me Later and Dismiss, and always open Wage Tracker for confirmation before changing a shift.
      </p>
      {error && <p className="settings-error smart-reminder-error" role="alert">{error}</p>}
    </section>
  );
}
