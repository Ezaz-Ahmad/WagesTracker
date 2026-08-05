import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";

export function SettingsScreen() {
  const { user, updateSettings, logout, deleteAccount } = useApp();
  const [name, setName] = useState(user?.name ?? "");
  const [weekStartsOn, setWeekStartsOn] = useState<"Monday" | "Sunday">(user?.weekStartsOn ?? "Monday");
  const [workLocationName, setWorkLocationName] = useState(user?.workLocationName ?? "");
  const [workAddress, setWorkAddress] = useState(user?.workAddress ?? "");
  const [multipleLocations, setMultipleLocations] = useState(user?.multipleLocations ?? false);
  const [otherLocations, setOtherLocations] = useState(user?.otherLocations ?? "");
  const [rate, setRate] = useState(user?.rate ?? 0);
  const [goalHours, setGoalHours] = useState(user?.goalHours ?? 0);
  const [goalEarnings, setGoalEarnings] = useState(user?.goalEarnings ?? 0);
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  function handleAutoGoal() {
    setGoalEarnings(Math.round(rate * goalHours * 100) / 100);
  }

  function closeDeleteDialog() {
    if (deleting) return;
    setShowDeleteDialog(false);
    setDeletePassword("");
    setDeleteError(null);
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(deletePassword);
      // On success the app flips to the logged-out state and this screen unmounts.
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete account");
      setDeleting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateSettings({
        name,
        weekStartsOn,
        workLocationName,
        workAddress,
        multipleLocations,
        otherLocations,
        rate,
        goalHours,
        goalEarnings,
      });
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h6 className="section-title">Settings</h6>
      <div className="section-hint" style={{ marginBottom: "var(--space-4)" }}>
        Your rate, weekly goals and preferences.
      </div>

      <div className="field field-spaced">
        <label>Your name</label>
        <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field field-spaced">
        <label>Week starts on</label>
        <div className="seg">
          <label className="seg-opt">
            <input type="radio" name="weekstart" checked={weekStartsOn === "Monday"} onChange={() => setWeekStartsOn("Monday")} /> Monday
          </label>
          <label className="seg-opt">
            <input type="radio" name="weekstart" checked={weekStartsOn === "Sunday"} onChange={() => setWeekStartsOn("Sunday")} /> Sunday
          </label>
        </div>
      </div>

      <div className="hr" />
      <h6 className="section-title">Work details</h6>

      <div className="field field-spaced">
        <label>Work location name</label>
        <input className="input" type="text" value={workLocationName} onChange={(e) => setWorkLocationName(e.target.value)} />
      </div>
      <div className="field field-spaced">
        <label>Work address</label>
        <input className="input" type="text" value={workAddress} onChange={(e) => setWorkAddress(e.target.value)} />
      </div>
      <div className="field field-spaced">
        <label>Do you work multiple locations?</label>
        <div className="seg">
          <label className="seg-opt">
            <input type="radio" name="multiloc-s" checked={!multipleLocations} onChange={() => setMultipleLocations(false)} /> No
          </label>
          <label className="seg-opt">
            <input type="radio" name="multiloc-s" checked={multipleLocations} onChange={() => setMultipleLocations(true)} /> Yes
          </label>
        </div>
      </div>
      {multipleLocations && (
        <div className="field field-spaced">
          <label>Other locations</label>
          <input className="input" type="text" value={otherLocations} onChange={(e) => setOtherLocations(e.target.value)} />
        </div>
      )}

      <div className="hr" />
      <div className="field field-spaced">
        <label>Hourly rate ({CURRENCY})</label>
        <input
          className="input"
          type="number"
          step={0.25}
          min={0}
          value={rate}
          onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="field field-spaced">
        <label>Weekly hours goal</label>
        <input
          className="input"
          type="number"
          step={0.5}
          min={0}
          value={goalHours}
          onChange={(e) => setGoalHours(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="field" style={{ marginBottom: "var(--space-2)" }}>
        <label>Weekly earnings goal ({CURRENCY})</label>
        <input
          className="input"
          type="number"
          step={1}
          min={0}
          value={goalEarnings}
          onChange={(e) => setGoalEarnings(parseFloat(e.target.value) || 0)}
        />
      </div>
      <button className="btn btn-ghost" onClick={handleAutoGoal} style={{ marginBottom: "var(--space-4)" }}>
        Set goal = rate × hour goal
      </button>

      <div className="hr" />
      <button
        className={`btn btn-primary btn-block${saveFlash ? " btn-save-flash" : ""}`}
        onClick={handleSave}
        disabled={saving}
      >
        {saveFlash ? "Saved ✓" : saving ? "Saving…" : "Save settings"}
      </button>
      <button className="btn btn-secondary btn-block" onClick={logout}>
        Log out
      </button>
      <div className="settings-note">Time entries and reports are kept for 5 years and automatically deleted after that.</div>

      <div className="hr" />
      <h6 className="section-title">Danger zone</h6>
      <div className="section-hint">Permanently delete your account and every shift you've logged. This can't be undone.</div>
      <button className="btn btn-danger btn-block" onClick={() => setShowDeleteDialog(true)}>
        Delete account
      </button>

      {showDeleteDialog && (
        <div className="dialog-backdrop" onClick={closeDeleteDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Delete your account?</div>
            <p className="dialog-body">
              This permanently deletes your account, settings, and all logged shifts. There's no way to undo this.
              Enter your password to confirm.
            </p>
            {deleteError && <div className="form-error">{deleteError}</div>}
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                autoFocus
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && deletePassword && !deleting) void handleDeleteAccount();
                }}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeDeleteDialog} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDeleteAccount} disabled={deleting || !deletePassword}>
                {deleting ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
