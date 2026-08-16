import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useApp } from "../context/AppContext";
import { StatusBanner } from "../components/StatusBanner";
import { StableLabel } from "../components/StableLabel";
import { FaceIdIcon, TouchIdIcon } from "../components/icons";
import type { BiometryKind } from "../platform/biometricAuth";

function biometryName(kind: BiometryKind): string {
  if (kind === "faceId") return "Face ID";
  if (kind === "touchId") return "Touch ID";
  return "Face ID or Touch ID";
}

export function BiometricLoginSettings() {
  const { biometricCapabilities, biometricStatus, biometricBusy, enableBiometricLogin, disableBiometricLogin } =
    useApp();
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);

  // Checked at render time (not folded to a module-level constant) so it
  // reflects the actual runtime platform — Capacitor.isNativePlatform() is
  // false in any plain web/PWA context regardless of build target, which is
  // exactly the "Web/PWA: do not display a non-functional biometric
  // control" requirement. This is deliberately independent of
  // `biometricCapabilities`/`biometricStatus`: the web adapter already
  // reports `enrolled: false` too (see platform/biometricAuth.ts), but that
  // alone can't be told apart from "native device, nothing enrolled yet" —
  // which *should* render a disabled explanation rather than nothing.
  if (!Capacitor.isNativePlatform()) return null;

  // Prefer the kind the stored credential actually recorded once biometrics
  // is on (it can't retroactively change without going through disable/
  // re-enable), falling back to the live capability read the rest of the
  // time — both agree in the overwhelming common case, but this keeps a
  // freshly-disabled row from flashing "Face ID or Touch ID" for a frame.
  const kind = biometricStatus.enabled ? biometricStatus.kind ?? biometricCapabilities.kind : biometricCapabilities.kind;
  const Icon = kind === "touchId" ? TouchIdIcon : FaceIdIcon;
  const name = biometryName(kind);

  async function handleToggle() {
    setFeedback(null);
    if (biometricStatus.enabled) {
      await disableBiometricLogin();
      setFeedback({ tone: "success", message: `${name} sign-in turned off.` });
      return;
    }
    const result = await enableBiometricLogin();
    if (result.outcome === "enabled") {
      setFeedback({
        tone: "success",
        message: `${name} sign-in is on. You'll be asked to confirm with ${name} the next time you open the app.`,
      });
      return;
    }
    // Cancelling or missing the prompt is an ordinary outcome, not a
    // failure worth a banner — the toggle just stays off, matching "keep
    // the setting off if authentication fails or is cancelled."
    if (result.reason && result.reason !== "user_cancelled" && result.reason !== "app_backgrounded") {
      setFeedback({ tone: "danger", message: result.error || `Couldn't turn on ${name} sign-in.` });
    }
  }

  // Hardware present but nothing enrolled (or no compatible hardware at
  // all) — requirement 2's "disabled option with a clear explanation."
  // `biometricStatus.enabled` can't be true here on a fresh read (enabling
  // requires a live prompt, which requires enrollment), so this check alone
  // is enough to gate the disabled branch.
  if (!biometricCapabilities.enrolled) {
    return (
      <div className="settings-section-card card">
        <h3 className="settings-subsection-title">Biometric login</h3>
        <div className="biometric-row is-disabled" aria-disabled="true">
          <span className="biometric-row-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <div>
            <div className="biometric-row-label">Use {name}</div>
            <div className="section-hint" style={{ marginBottom: 0 }}>
              {biometricCapabilities.reason}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section-card card">
      <h3 className="settings-subsection-title">Biometric login</h3>
      <div className="section-hint">
        {biometricStatus.enabled
          ? `Confirm with ${name} instead of retyping your password each time you open the app. This also keeps you signed in on this device for up to 5 years, instead of the usual 30 days, since ${name} re-entry takes over as the periodic check.`
          : `Turn on ${name} to skip retyping your password on this device, and to stay signed in far longer here (up to 5 years, instead of the usual 30 days). Your password still works everywhere, and every sign-in is still checked against your account.`}
      </div>
      {feedback && (
        <StatusBanner tone={feedback.tone} onDismiss={() => setFeedback(null)} dismissLabel="Dismiss this message">
          {feedback.message}
        </StatusBanner>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-block biometric-toggle-btn"
        onClick={() => void handleToggle()}
        disabled={biometricBusy}
        aria-pressed={biometricStatus.enabled}
      >
        <Icon size={18} />
        <StableLabel
          current={biometricBusy ? "Confirming…" : biometricStatus.enabled ? `Turn off ${name}` : `Use ${name}`}
          longest={`Turn off Face ID or Touch ID`}
        />
      </button>
    </div>
  );
}
