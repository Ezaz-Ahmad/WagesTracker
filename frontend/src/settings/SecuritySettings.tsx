import { useState, type FormEvent } from "react";
import { useApp } from "../context/AppContext";
import { PasswordInput } from "../components/PasswordInput";
import { validatePassword } from "../lib/passwordPolicy";
import { StableLabel } from "../components/StableLabel";
import { StatusBanner } from "../components/StatusBanner";
import { SessionList } from "./SessionList";
import { BiometricLoginSettings } from "./BiometricLoginSettings";

export function SecuritySettings() {
  const { changePassword, loadSessions } = useApp();
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

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword || confirmMismatch || newPasswordCheck?.valid === false) return;
    setChangingPassword(true);
    setPasswordError(null);
    try {
      // changePassword (AppContext) stores the replacement token — issued by
      // the backend for the new session it just created — before its promise
      // resolves, so by the time we get here every subsequent request
      // (including the loadSessions call below) already carries the new
      // token, not the one that was just revoked.
      await changePassword(currentPassword, newPassword);
      // Refresh the session list against the replacement token so the old,
      // now-revoked sessions disappear and the new one shows as "This
      // device" immediately. loadSessions manages its own loading/error
      // state and never throws, so a failure here surfaces only through the
      // sessions section below — it can never turn into a false
      // "password change failed" error.
      await loadSessions();
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

  return (
    <>
    <div className="settings-section-card card">
      <h3 className="settings-subsection-title">Change password</h3>
      <div className="section-hint">
        Use at least 15 characters — a short memorable phrase works better than a short complicated one. No need for
        symbols or numbers, but common or app-related passwords are rejected.
      </div>
      <form onSubmit={handleChangePassword} autoComplete="on">
        {/* Was the one .banner in the app rendered without its icon, so this
            single message conveyed "error" by colour alone. */}
        {passwordError && <StatusBanner tone="danger">{passwordError}</StatusBanner>}
        <div className="field field-spaced">
          <label htmlFor="settings-current-password">Current password</label>
          <PasswordInput
            id="settings-current-password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field field-spaced">
          <label htmlFor="settings-new-password">New password</label>
          <PasswordInput
            id="settings-new-password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={newPasswordCheck && !newPasswordCheck.valid ? true : undefined}
            aria-describedby={newPasswordCheck && !newPasswordCheck.valid ? "settings-new-password-hint" : undefined}
          />
          {newPasswordCheck && !newPasswordCheck.valid && (
            <div id="settings-new-password-hint" className="field-hint field-hint-danger">
              {newPasswordCheck.error}
            </div>
          )}
        </div>
        <div className="field field-spaced">
          <label htmlFor="settings-confirm-new-password">Confirm new password</label>
          <PasswordInput
            id="settings-confirm-new-password"
            autoComplete="new-password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            aria-invalid={confirmMismatch || undefined}
            aria-describedby={confirmMismatch ? "settings-confirm-new-password-hint" : undefined}
          />
          {confirmMismatch && (
            <div id="settings-confirm-new-password-hint" className="field-hint field-hint-danger">
              Passwords don't match
            </div>
          )}
        </div>
        {/* The trailing "✓" duplicated the banner's own icon; one tick is
            enough, and a screen reader announced the character too. */}
        {passwordFlash && <StatusBanner tone="success">Password changed</StatusBanner>}
        <button
          className="btn btn-secondary btn-block"
          type="submit"
          disabled={
            changingPassword ||
            !currentPassword ||
            !newPassword ||
            confirmMismatch ||
            (newPasswordCheck ? !newPasswordCheck.valid : false)
          }
        >
          <StableLabel current={changingPassword ? "Changing…" : "Change password"} longest="Change password" />
        </button>
      </form>

      <div className="hr" />
      <h3 className="settings-subsection-title">Active sessions</h3>
      <SessionList />
    </div>
    <BiometricLoginSettings />
    </>
  );
}
