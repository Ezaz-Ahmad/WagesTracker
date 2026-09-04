import { useState } from "react";
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
    <div className="settings-section-card card">
      <div className="active-shift-preference-row">
        <div className="active-shift-preference-copy">
          <h3 className="settings-subsection-title">Active shift notification</h3>
          <p id="active-shift-preference-hint" className="section-hint">
            Show elapsed time, start time and a secure End Shift action on your iPhone at a glance.
            This is off by default and affects only this account on this device.
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
    </div>
  );
}
