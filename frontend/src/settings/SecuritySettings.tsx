import { useState, type FormEvent } from "react";
import { useApp } from "../context/AppContext";
import { PasswordInput } from "../components/PasswordInput";
import { validatePassword } from "../lib/passwordPolicy";
import { AsyncButton } from "../components/AsyncButton";
import { StatusBanner } from "../components/StatusBanner";
import { SessionList } from "./SessionList";
import { BiometricLoginSettings } from "./BiometricLoginSettings";
import { requestEmailChange } from "../lib/api";
import { validateEmailAddress } from "../lib/emailPolicy";
import { showErrorPopup } from "../lib/errorFeedback";

export function SecuritySettings() {
  const { user, changePassword, loadSessions } = useApp();
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [acceptedEmailAsEntered, setAcceptedEmailAsEntered] = useState<string | null>(null);
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
  const emailCheck = newEmail ? validateEmailAddress(newEmail) : null;

  async function handleChangeEmail(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailMessage(null);
    if (!emailCheck?.valid) {
      const message = emailCheck?.error ?? "Enter your new email address.";
      setEmailError(message);
      showErrorPopup({ title: "Check the new email", message, hint: "Correct the highlighted field; your current login email is still active.", field: "newEmail" });
      return;
    }
    if (emailCheck.suggestion && acceptedEmailAsEntered !== emailCheck.normalized) {
      const message = `The part after @ may be misspelled. Did you mean ${emailCheck.suggestion}?`;
      setEmailError(message);
      showErrorPopup({ title: "Check the new email", message, hint: "Use the suggestion or choose Keep mine before continuing.", field: "newEmail", suggestion: emailCheck.suggestion });
      return;
    }
    if (!emailPassword) {
      const message = "Enter your current password to confirm this change.";
      setEmailError(message);
      showErrorPopup({ title: "Current password required", message, hint: "Your password will be checked, not changed.", field: "currentPassword" });
      return;
    }
    setChangingEmail(true);
    try {
      const result = await requestEmailChange(emailPassword, newEmail, acceptedEmailAsEntered === emailCheck.normalized);
      setNewEmail(result.pendingEmail);
      setEmailPassword("");
      setEmailMessage(result.message);
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Couldn't start the email change.");
    } finally {
      setChangingEmail(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      const message = "Enter your current password.";
      setPasswordError(message);
      showErrorPopup({ title: "Current password required", message, hint: "Your entries are still here.", field: "passwordCurrentPassword" });
      return;
    }
    if (!newPassword || newPasswordCheck?.valid === false) {
      const message = newPasswordCheck?.error ?? "Enter a new password.";
      setPasswordError(message);
      showErrorPopup({ title: "Check the new password", message, hint: "Use 10–128 characters and avoid common passwords.", field: "newPassword" });
      return;
    }
    if (confirmMismatch || !confirmNewPassword) {
      const message = "Enter the new password again so both entries match.";
      setPasswordError(message);
      showErrorPopup({ title: "Passwords don't match", message, hint: "Your other entries are still here.", field: "confirmNewPassword" });
      return;
    }
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
      <h3 className="settings-subsection-title">Change email</h3>
      <div className="section-hint">
        Current email: <strong>{user?.email}</strong>. We'll verify the new address before activating it. Your password and account data stay unchanged.
      </div>
      <form onSubmit={handleChangeEmail} noValidate>
        {emailError && <StatusBanner tone="danger">{emailError}</StatusBanner>}
        {emailMessage && <StatusBanner tone="success">{emailMessage}</StatusBanner>}
        <div className="field field-spaced">
          <label htmlFor="settings-new-email">New email</label>
          <input
            id="settings-new-email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={newEmail}
            onChange={(event) => { setNewEmail(event.target.value); setAcceptedEmailAsEntered(null); setEmailMessage(null); }}
            data-error-field="newEmail"
            aria-invalid={emailCheck && (!emailCheck.valid || Boolean(emailCheck.suggestion && acceptedEmailAsEntered !== emailCheck.normalized)) ? true : undefined}
            aria-describedby="settings-new-email-hint"
          />
          {emailCheck && !emailCheck.valid && <div id="settings-new-email-hint" className="field-hint field-hint-danger">{emailCheck.error}</div>}
          {emailCheck?.valid && emailCheck.suggestion && acceptedEmailAsEntered !== emailCheck.normalized && (
            <div id="settings-new-email-hint" className="email-suggestion" role="status">
              <span>Did you mean <strong>{emailCheck.suggestion}</strong>?</span>
              <span className="email-suggestion-actions">
                <button type="button" className="auth-text-link" onClick={() => { setNewEmail(emailCheck.suggestion!); setAcceptedEmailAsEntered(null); }}>Use suggestion</button>
                <button type="button" className="auth-text-link" onClick={() => setAcceptedEmailAsEntered(emailCheck.normalized)}>Keep mine</button>
              </span>
            </div>
          )}
          {(!emailCheck || (emailCheck.valid && (!emailCheck.suggestion || acceptedEmailAsEntered === emailCheck.normalized))) && <div id="settings-new-email-hint" className="field-hint">We'll send the confirmation link here. The old email remains active until you use it.</div>}
        </div>
        <div className="field field-spaced">
          <label htmlFor="settings-email-current-password">Confirm with current password</label>
          <PasswordInput id="settings-email-current-password" autoComplete="current-password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} data-error-field="currentPassword" />
        </div>
        <AsyncButton className="btn btn-secondary btn-block" type="submit" busy={changingEmail} idleLabel="Send verification link" busyLabel="Sending verification…" />
      </form>

      <div className="hr" />
      <h3 className="settings-subsection-title">Change password</h3>
      <div className="section-hint">
        Use 10–128 characters. Symbols, capital letters, and numbers are optional. Easy-to-guess passwords are blocked.
      </div>
      <form onSubmit={handleChangePassword} autoComplete="on" noValidate>
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
            data-error-field="passwordCurrentPassword"
          />
        </div>
        <div className="field field-spaced">
          <label htmlFor="settings-new-password">New password</label>
          <PasswordInput
            id="settings-new-password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            data-error-field="newPassword"
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
            data-error-field="confirmNewPassword"
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
        <AsyncButton
          className="btn btn-secondary btn-block"
          type="submit"
          busy={changingPassword}
          idleLabel="Change password"
          busyLabel="Changing password…"
        />
      </form>

      <div className="hr" />
      <h3 className="settings-subsection-title">Signed-in devices</h3>
      <SessionList />
    </div>
    <BiometricLoginSettings />
    </>
  );
}
