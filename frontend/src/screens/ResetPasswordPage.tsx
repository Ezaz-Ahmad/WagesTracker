import { useCallback, useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { BubbleLoader } from "../components/BubbleLoader";
import { PasswordInput } from "../components/PasswordInput";
import { PublicPageShell } from "../components/PublicPageShell";
import { StatusBanner } from "../components/StatusBanner";
import { ApiError, checkPasswordResetToken, resetPassword } from "../lib/api";
import { MIN_PASSWORD_LENGTH, validatePassword } from "../lib/passwordPolicy";
import { clearDeepLink } from "../platform/deepLinks";

type Stage = "checking" | "form" | "invalid" | "done";

function tokenFromLocation(): string {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return fragment.get("token") ?? "";
}

export function ResetPasswordPage({ token: providedToken }: { token?: string } = {}) {
  const [token] = useState(() => providedToken ?? tokenFromLocation());
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const passwordCheck = password ? validatePassword(password) : null;
  const mismatch = confirmation.length > 0 && confirmation !== password;

  // Email links use a URL fragment, which browsers never send to Vercel,
  // the API, or Referer headers. Remove it before first paint so it also
  // disappears from the address bar and browser history immediately.
  useLayoutEffect(() => {
    if (!window.location.hash) return;
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setMessage("This password reset link is incomplete. Request a new one to continue.");
      setStage("invalid");
      return;
    }

    void checkPasswordResetToken(token)
      .then(() => {
        if (!cancelled) setStage("form");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const nextMessage = error instanceof ApiError && error.status === 0
          ? "We couldn't reach Wage Tracker to check this link. Check your connection and reload the page."
          : error instanceof Error
            ? error.message
            : "This password reset link is no longer valid.";
        setMessage(nextMessage);
        setStage("invalid");
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !password || mismatch || passwordCheck?.valid === false) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await resetPassword(token, password);
      setMessage(result.message);
      setPassword("");
      setConfirmation("");
      setStage("done");
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "We couldn't reset your password. Please try again.";
      setMessage(nextMessage);
      if (error instanceof ApiError && error.code === "INVALID_RESET_TOKEN") setStage("invalid");
    } finally {
      setSubmitting(false);
    }
  }, [mismatch, password, passwordCheck?.valid, submitting, token]);

  const handleReturnToApp = useCallback(() => {
    // Do not prevent the anchor's default full navigation. Reloading the
    // native web view makes AppProvider revalidate its now-revoked session,
    // rather than briefly returning to an authenticated shell with stale
    // in-memory state after a successful reset.
    if (providedToken) clearDeepLink();
  }, [providedToken]);

  return (
    <PublicPageShell
      eyebrow="Account recovery"
      title="Reset your password"
      summary="Choose a new password for your Wage Tracker account. Your shifts, spending, and reports remain unchanged."
    >
      {stage === "checking" && (
        <p className="public-page-note" role="status"><BubbleLoader label="Checking your link" /></p>
      )}

      {stage === "invalid" && (
        <>
          <StatusBanner tone="danger">{message ?? "This password reset link is no longer valid."}</StatusBanner>
          <p>Reset links work once and expire after 25 minutes. Return to Wage Tracker and choose <strong>Forgot password?</strong> to request another.</p>
          <p><a className="btn btn-primary" href="/" onClick={handleReturnToApp}>Back to Wage Tracker</a></p>
        </>
      )}

      {stage === "done" && (
        <>
          <StatusBanner tone="success">
            {message ?? "Your password has been reset."} Every previously signed-in device has been signed out.
          </StatusBanner>
          <p>Sign in again with your new password. If Face ID or Touch ID was enabled, sign in once with the new password before enabling it again.</p>
          <p><a className="btn btn-primary" href="/" onClick={handleReturnToApp}>Go to log in</a></p>
        </>
      )}

      {stage === "form" && (
        <form onSubmit={handleSubmit} autoComplete="on" noValidate>
          {message && <StatusBanner tone="danger">{message}</StatusBanner>}

          <div className="field field-spaced">
            <label htmlFor="reset-password">New password</label>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              aria-invalid={passwordCheck && !passwordCheck.valid ? true : undefined}
              aria-describedby="reset-password-hint"
              required
              autoFocus
            />
            {passwordCheck && !passwordCheck.valid ? (
              <div id="reset-password-hint" className="field-hint field-hint-danger">{passwordCheck.error}</div>
            ) : (
              <div id="reset-password-hint" className="field-hint">
                At least {MIN_PASSWORD_LENGTH} characters—a memorable phrase is welcome, with no symbol or number requirement.
              </div>
            )}
          </div>

          <div className="field field-spaced">
            <label htmlFor="reset-password-confirmation">Confirm new password</label>
            <PasswordInput
              id="reset-password-confirmation"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? "reset-confirmation-hint" : undefined}
              required
            />
            {mismatch && <div id="reset-confirmation-hint" className="field-hint field-hint-danger">Passwords don't match</div>}
          </div>

          <button
            className="btn btn-primary btn-block"
            type="submit"
            style={{ justifyContent: "center" }}
            disabled={submitting || !password || mismatch || (passwordCheck ? !passwordCheck.valid : false)}
          >
            {submitting ? <BubbleLoader label="Saving your new password" /> : "Set new password"}
          </button>
          <p className="public-page-note">For your security, resetting the password signs out every active device.</p>
        </form>
      )}
    </PublicPageShell>
  );
}
