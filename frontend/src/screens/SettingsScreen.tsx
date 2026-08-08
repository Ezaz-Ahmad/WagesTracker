import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { PasswordInput } from "../components/PasswordInput";
import { AppCredit } from "../components/AppCredit";
import { useDismissTransition } from "../lib/useDismissTransition";
import { validatePassword } from "../lib/passwordPolicy";

export function SettingsScreen() {
  const { user, updateSettings, changePassword, deleteAccount } = useApp();
  const [name, setName] = useState(user?.name ?? "");
  const [address, setAddress] = useState(user?.address ?? "");
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

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordFlash, setPasswordFlash] = useState(false);
  // Only shown once the user has actually typed something in the new-password
  // field — not on first render, so the form doesn't open with a wall of red.
  const newPasswordCheck = newPassword ? validatePassword(newPassword) : null;
  const confirmMismatch = confirmNewPassword.length > 0 && confirmNewPassword !== newPassword;

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Plays a quick fade+scale-out on close instead of the dialog vanishing
  // the instant state clears — see useDismissTransition.
  const { closing: deleteDialogClosing, requestClose: requestCloseDeleteDialog } = useDismissTransition(180);

  if (!user) return null;

  function handleAutoGoal() {
    setGoalEarnings(Math.round(rate * goalHours * 100) / 100);
  }

  function closeDeleteDialog() {
    if (deleting) return;
    requestCloseDeleteDialog(() => {
      setShowDeleteDialog(false);
      setDeletePassword("");
      setDeleteError(null);
    });
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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword || confirmMismatch || newPasswordCheck?.valid === false) return;
    setChangingPassword(true);
    setPasswordError(null);
    try {
      await changePassword(currentPassword, newPassword);
      // Clear the form on success — never leave a just-used password sitting in state.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordFlash(true);
      setTimeout(() => setPasswordFlash(false), 2500);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Couldn't change password");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateSettings({
        name,
        address,
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
    <div className="screen-narrow">
      <h6 className="section-title">Settings</h6>
      <div className="section-hint" style={{ marginBottom: "var(--space-4)" }}>
        Your rate, weekly goals and preferences.
      </div>

      <div className="field field-spaced">
        <label>Your name</label>
        <input className="input" type="text" placeholder="Alex Rivera" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field field-spaced">
        <label>Your address</label>
        <input
          className="input"
          type="text"
          placeholder="123 Main St, Springfield"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <div className="field-hint">Shown on your PDF reports, under your name — not the work location below.</div>
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
        <input className="input" type="text" placeholder="Downtown Store" value={workLocationName} onChange={(e) => setWorkLocationName(e.target.value)} />
      </div>
      <div className="field field-spaced">
        <label>Work address</label>
        <input className="input" type="text" placeholder="123 Main St, Springfield" value={workAddress} onChange={(e) => setWorkAddress(e.target.value)} />
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
          <input className="input" type="text" placeholder="e.g. Uptown Branch, Airport Kiosk" value={otherLocations} onChange={(e) => setOtherLocations(e.target.value)} />
        </div>
      )}

      <div className="hr" />
      <div className="field field-spaced">
        <label>Hourly rate ({CURRENCY})</label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step={0.25}
          min={0}
          placeholder="e.g. 25.00"
          value={rate || ""}
          onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="field field-spaced">
        <label>Weekly hours goal</label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step={0.5}
          min={0}
          placeholder="e.g. 35"
          value={goalHours || ""}
          onChange={(e) => setGoalHours(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="field" style={{ marginBottom: "var(--space-2)" }}>
        <label>Weekly earnings goal ({CURRENCY})</label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step={1}
          min={0}
          placeholder="e.g. 650"
          value={goalEarnings || ""}
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
      <div className="settings-note">
        Time entries and reports are kept for 5 years and automatically deleted after that. Log out from the button at
        the top of the app.
      </div>
      <AppCredit showVersion />

      <div className="hr" />
      <h6 className="section-title">Change password</h6>
      <div className="section-hint" style={{ marginBottom: "var(--space-3)" }}>
        Use at least 15 characters — a short memorable phrase works better than a short complicated one. No need for
        symbols or numbers, but common or app-related passwords are rejected.
      </div>
      <form onSubmit={handleChangePassword} autoComplete="on">
        {passwordError && <div className="form-error">{passwordError}</div>}
        <div className="field field-spaced">
          <label>Current password</label>
          <PasswordInput
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field field-spaced">
          <label>New password</label>
          <PasswordInput
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {newPasswordCheck && !newPasswordCheck.valid && <div className="field-hint">{newPasswordCheck.error}</div>}
        </div>
        <div className="field" style={{ marginBottom: "var(--space-3)" }}>
          <label>Confirm new password</label>
          <PasswordInput
            autoComplete="new-password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
          />
          {confirmMismatch && <div className="field-hint">Passwords don't match</div>}
        </div>
        <button
          className={`btn btn-secondary btn-block${passwordFlash ? " btn-save-flash" : ""}`}
          type="submit"
          disabled={
            changingPassword ||
            !currentPassword ||
            !newPassword ||
            confirmMismatch ||
            (newPasswordCheck ? !newPasswordCheck.valid : false)
          }
        >
          {passwordFlash ? "Password changed ✓" : changingPassword ? "Changing…" : "Change password"}
        </button>
      </form>

      <div className="hr" />
      <h6 className="section-title">Danger zone</h6>
      <div className="section-hint">Permanently delete your account and every shift you've logged. This can't be undone.</div>
      <button className="btn btn-danger btn-block" onClick={() => setShowDeleteDialog(true)}>
        Delete account
      </button>

      {showDeleteDialog && (
        <div className={`dialog-backdrop${deleteDialogClosing ? " is-closing" : ""}`} onClick={closeDeleteDialog}>
          <div className={`dialog${deleteDialogClosing ? " is-closing" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Delete your account?</div>
            <p className="dialog-body">
              This permanently deletes your account, settings, and all logged shifts. There's no way to undo this.
              Enter your password to confirm.
            </p>
            {deleteError && <div className="form-error">{deleteError}</div>}
            <div className="field">
              <label>Password</label>
              <PasswordInput
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
              <button
                className="btn btn-danger"
                onClick={handleDeleteAccount}
                disabled={deleting || !deletePassword}
                data-confirm="Final check: permanently delete your account and every shift you've logged? There's no way to undo this."
                data-confirm-tone="danger"
              >
                {deleting ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
