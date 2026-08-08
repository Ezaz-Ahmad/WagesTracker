import { useEffect, useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { PasswordInput } from "../components/PasswordInput";
import { AppCredit } from "../components/AppCredit";
import { useDismissTransition } from "../lib/useDismissTransition";
import { validatePassword } from "../lib/passwordPolicy";

/** "Aug 15, 3:42 PM" — used for session created/last-active timestamps.
 * Falls back to a plain label rather than throwing or showing "Invalid
 * Date" if a timestamp is ever missing or malformed. */
function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SettingsScreen() {
  const {
    user,
    updateSettings,
    changePassword,
    deleteAccount,
    sessions,
    sessionsLoading,
    sessionsError,
    loadSessions,
    revokeSession,
    revokeOtherSessions,
  } = useApp();
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

  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [sessionActionMessage, setSessionActionMessage] = useState<string | null>(null);

  // Loaded once when Settings mounts — refreshed again after any revoke
  // below (loadSessions is called again inside AppContext's revokeSession/
  // revokeOtherSessions on success) so the list never shows a stale entry
  // for a device that was just logged out.
  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // changePassword (AppContext) stores the replacement token — issued by
      // the backend for the new session it just created — before its promise
      // resolves, so by the time we get here every subsequent request
      // (including the loadSessions call below) already carries the new
      // token, not the one that was just revoked.
      await changePassword(currentPassword, newPassword);
      // Refresh the session list against the replacement token so the old,
      // now-revoked sessions disappear and the new one shows as "This
      // device" immediately — without this, the list would keep showing
      // stale data from before the password change until Settings was
      // reopened. loadSessions manages its own loading/error state
      // (sessionsError) and never throws, so a failure here surfaces only
      // through the sessions section below — it can never turn into a
      // false "password change failed" error.
      await loadSessions();
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

  async function handleRevokeSession(sessionId: string) {
    setRevokingSessionId(sessionId);
    setSessionActionError(null);
    setSessionActionMessage(null);
    try {
      await revokeSession(sessionId);
      // If that was this device's own current session, revokeSession above
      // already logged the app out and this screen is about to unmount —
      // nothing else to do here.
      setSessionActionMessage("That device has been logged out.");
    } catch (e) {
      setSessionActionError(e instanceof Error ? e.message : "Couldn't log out that device");
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeOtherSessions() {
    setRevokingOthers(true);
    setSessionActionError(null);
    setSessionActionMessage(null);
    try {
      await revokeOtherSessions();
      setSessionActionMessage("All other devices have been logged out.");
    } catch (e) {
      setSessionActionError(e instanceof Error ? e.message : "Couldn't log out other devices");
    } finally {
      setRevokingOthers(false);
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
      <h6 className="section-title">Security &amp; Sessions</h6>
      <div className="section-hint" style={{ marginBottom: "var(--space-3)" }}>
        Devices currently signed in to your account. If you don't recognize one, log it out.
      </div>

      {sessionActionError && (
        <div className="form-error" role="alert">
          {sessionActionError}
        </div>
      )}
      {sessionActionMessage && (
        <div className="section-hint" role="status" style={{ marginBottom: "var(--space-3)" }}>
          {sessionActionMessage}
        </div>
      )}

      {sessionsLoading && sessions.length === 0 ? (
        <div className="section-hint" role="status">
          Loading sessions…
        </div>
      ) : sessionsError ? (
        <div className="form-error" role="alert">
          {sessionsError}
        </div>
      ) : sessions.length === 0 ? (
        <div className="section-hint">No active sessions found.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {sessions.map((s) => (
            <li key={s.id} className="card" style={{ marginBottom: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <strong>{s.userAgent || "Unknown device"}</strong>
                {s.isCurrent && <span className="tag tag-accent-2">This device</span>}
              </div>
              <div className="field-hint">
                {s.ipAddress && <>IP {s.ipAddress} · </>}
                Created {formatSessionTime(s.createdAt)} · Last active {formatSessionTime(s.lastActiveAt)}
              </div>
              {!s.isCurrent && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: "var(--space-2)" }}
                  onClick={() => handleRevokeSession(s.id)}
                  disabled={revokingSessionId === s.id}
                  data-confirm={`Log out ${s.userAgent || "this device"}? It will need to sign in again.`}
                  aria-label={`Log out ${s.userAgent || "this device"}`}
                >
                  {revokingSessionId === s.id ? "Logging out…" : "Log out"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sessions.some((s) => !s.isCurrent) && (
        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={handleRevokeOtherSessions}
          disabled={revokingOthers}
          data-confirm="Log out all other devices? Only this device will stay signed in."
          data-confirm-tone="danger"
        >
          {revokingOthers ? "Logging out other devices…" : "Log out all other devices"}
        </button>
      )}

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
