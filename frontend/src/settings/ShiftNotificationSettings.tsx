import { Capacitor } from "@capacitor/core";
import { useShiftNotificationSetting } from "../lib/useTodayShift";
import { StableLabel } from "../components/StableLabel";

/**
 * Lets a user turn the "shift in progress" notification (see
 * `docs/shift-notification-handoff.md`) on or off per device — added after
 * the feature itself shipped, so someone who doesn't want a persistent
 * notification sitting in their notification center for every shift has a
 * way to say so instead of it being permanently on.
 *
 * Native iOS only, same gating as `BiometricLoginSettings`: the underlying
 * feature doesn't exist on web/PWA at all (`WebShiftNotificationAdapter` is
 * a no-op — see `platform/shiftNotifications.ts`), so there is nothing for
 * this control to toggle there.
 */
export function ShiftNotificationSettings() {
  const { enabled, setEnabled } = useShiftNotificationSetting();

  if (!Capacitor.isNativePlatform()) return null;

  return (
    <div className="settings-section-card card">
      <h3 className="settings-subsection-title">Shift notification</h3>
      <div className="section-hint">
        {enabled
          ? "While a shift is open, a notification stays in your notification center with a quick Sign out action — even if the app isn't running."
          : "Turned off for shifts you start from now on — no notification will show. You can still sign out from within the app as usual. A shift already in progress keeps whatever notification it already posted until it ends."}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={() => setEnabled(!enabled)}
        aria-pressed={enabled}
      >
        <StableLabel
          current={enabled ? "Turn off shift notification" : "Turn on shift notification"}
          longest="Turn off shift notification"
        />
      </button>
    </div>
  );
}
