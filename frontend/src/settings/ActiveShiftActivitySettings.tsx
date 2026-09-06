import { useState } from "react";
import { SmartphoneIcon } from "../components/icons";
import { useApp } from "../context/AppContext";
import { isActiveShiftActivityConfigured } from "../platform/activeShiftActivity";

export function ActiveShiftActivitySettings() {
  const { activeShiftActivityEnabled, setActiveShiftActivityEnabled } = useApp();
  const [busy, setBusy] = useState(false);

  // This setting controls a native device surface. Hiding it completely on
  // web/PWA avoids presenting a switch that could never do anything.
  if (!isActiveShiftActivityConfigured()) return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await setActiveShiftActivityEnabled(!activeShiftActivityEnabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section-card card active-shift-settings" aria-labelledby="active-shift-preference-title">
      <div className="active-shift-preference-row">
        <span className="active-shift-preference-icon" aria-hidden="true"><SmartphoneIcon size={20} /></span>
        <div className="active-shift-preference-copy">
          <span className="weekly-cycle-eyebrow">On your iPhone</span>
          <h3 id="active-shift-preference-title" className="settings-subsection-title">Active shift notification</h3>
          <p id="active-shift-preference-hint" className="section-hint">
            Keep your current shift visible with elapsed time and a quick End Shift button.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={activeShiftActivityEnabled}
          aria-describedby="active-shift-preference-hint"
          aria-label="Active shift notification"
          className={`settings-switch${activeShiftActivityEnabled ? " is-on" : ""}`}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <span className="settings-switch-track" aria-hidden="true">
            <span className="settings-switch-thumb" />
          </span>
          <span className="settings-switch-state" aria-hidden="true">
            {busy ? "Saving…" : activeShiftActivityEnabled ? "On" : "Off"}
          </span>
        </button>
      </div>
    </section>
  );
}
