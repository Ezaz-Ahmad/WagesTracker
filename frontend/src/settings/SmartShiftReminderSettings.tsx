import { useState } from "react";
import { SmartBellIcon } from "../components/icons";
import { useApp } from "../context/AppContext";
import { formatReminderTime, getSmartShiftLearningProgress } from "../lib/smartShiftReminders";

export function SmartShiftReminderSettings() {
  const {
    user,
    smartReminderPatterns,
    smartReminderAuthorization,
    setSmartRemindersEnabled,
    shifts,
  } = useApp();
  // Several isolated Settings tests provide only the fields relevant to the
  // panel they exercise. Runtime AppProvider always supplies these values;
  // the fallbacks keep this leaf component equally harmless in isolation.
  const patterns = smartReminderPatterns ?? [];
  const authorization = smartReminderAuthorization ?? "unavailable";
  const progress = getSmartShiftLearningProgress(shifts ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = !!user?.smartRemindersEnabled;

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

  const learningStatus = progress.bestWeekdayCount >= 4
    ? {
        label: "Still learning",
        detail: `Your recent ${progress.bestWeekdayName} shifts vary, so we'll wait for a clearer routine.`,
      }
    : progress.bestWeekdayCount > 0
      ? {
          label: "Learning your routine",
          detail: `We're learning from your completed ${progress.bestWeekdayName} shifts.`,
        }
      : progress.completedShiftCount > 0
        ? {
            label: "Learning your new routine",
            detail: "Your schedule has changed, so reminders are quietly adapting.",
          }
        : {
            label: "Learning your routine",
            detail: "Complete shifts as usual. We'll let you know when reminders are ready.",
          };

  const status = !enabled
    ? {
        label: "Off",
        detail: "Turn this on for helpful reminders around your usual shifts.",
      }
    : authorization === "denied"
      ? {
          label: "Notifications are off",
          detail: "Allow notifications in iPhone Settings to receive smart shift reminders.",
        }
      : patterns.length === 0
        ? learningStatus
        : {
            label: "Ready",
            detail: patterns.length === 1
              ? `Smart reminders are ready for your ${patterns[0].weekdayName} routine.`
              : `Smart reminders are ready for ${patterns.length} days in your routine.`,
          };

  const statusTone = !enabled
    ? "is-off"
    : authorization === "denied"
      ? "is-blocked"
      : patterns.length > 0
        ? "is-ready"
        : "is-learning";

  return (
    <section className={`card smart-reminder-settings${enabled ? " is-enabled" : ""}`} aria-labelledby="smart-reminder-title">
      <div className="smart-reminder-glow" aria-hidden="true" />
      <div className="smart-reminder-head">
        <span className="smart-reminder-icon" aria-hidden="true"><SmartBellIcon size={22} /></span>
        <div className="smart-reminder-heading-copy">
          <span className="weekly-cycle-eyebrow">A helpful nudge</span>
          <h3 id="smart-reminder-title">Smart shift reminders</h3>
          <p>
            Get a gentle reminder when it looks like you forgot to start or finish a usual shift.
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
        Uses completed shifts to learn your usual weekday routine and may remind you when a usual start or finish is missed.
      </p>

      <div className={`smart-reminder-status-row ${statusTone}`} id="smart-reminder-status" role="status">
        <span className="smart-reminder-status-dot" aria-hidden="true" />
        <span className="smart-reminder-status-copy">
          <strong>{status.label}</strong>
          <small>{status.detail}</small>
        </span>
      </div>

      {enabled && patterns.length > 0 && (
        <div className="smart-reminder-routines-wrap">
          <p className="smart-reminder-routines-title">Your usual shifts</p>
          <div className="smart-reminder-routines" aria-label="Usual shift times">
            {patterns.map((pattern) => (
              <div className="smart-reminder-routine" key={pattern.weekday}>
                <strong className="smart-reminder-routine-day">{pattern.weekdayName}</strong>
                <span className="smart-reminder-routine-time">
                  {formatReminderTime(pattern.usualStartMinutes)} <i aria-hidden="true">–</i> {formatReminderTime(pattern.usualEndOffsetMinutes)}
                </span>
                <small>Ready</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="smart-reminder-reassurance">
        We'll stay quiet when your routine isn't clear.
      </p>
      {error && <p className="settings-error smart-reminder-error" role="alert">{error}</p>}
    </section>
  );
}
