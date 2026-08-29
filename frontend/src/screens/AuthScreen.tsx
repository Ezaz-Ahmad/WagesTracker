import { useRef, useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { getRememberedEmail, requestPasswordReset } from "../lib/api";
import { FaceIdIcon, LockIcon, TouchIdIcon } from "../components/icons";
import { LandingHeroContent } from "../components/LandingHero";
import { PasswordInput } from "../components/PasswordInput";
import { AuthFooter } from "../components/AuthFooter";
import { AsyncButton } from "../components/AsyncButton";
import { Logo } from "../components/Logo";
import { StatusBanner } from "../components/StatusBanner";
import { MIN_PASSWORD_LENGTH, validatePassword } from "../lib/passwordPolicy";

type Mode = "login" | "signup" | "forgot";

function biometryName(kind: "faceId" | "touchId" | "none"): string {
  if (kind === "faceId") return "Face ID";
  if (kind === "touchId") return "Touch ID";
  return "biometric login";
}

export function AuthScreen() {
  const {
    login,
    signup,
    authError,
    authBusy,
    clearAuthError,
    biometricStatus,
    biometricBusy,
    biometricLoginError,
    clearBiometricLoginError,
    retryBiometricLogin,
  } = useApp();
  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState(() => getRememberedEmail() ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [workLocationName, setWorkLocationName] = useState("");
  const [workAddress, setWorkAddress] = useState("");
  const [multipleLocations, setMultipleLocations] = useState(false);
  const [otherLocations, setOtherLocations] = useState("");
  const [rate, setRate] = useState("");
  const [remember, setRemember] = useState(true);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const signupRateRef = useRef<HTMLInputElement>(null);

  // `biometricStatus.enabled` is a device-level fact, not an account-level
  // one — this plugin stores at most one credential at a time (see
  // BiometricAuthPlugin.swift's "single account slot" note), so it stays
  // true even while a *different* account's credential currently occupies
  // that slot. Before this comparison existed, logging into a second
  // account on the same device showed the Face ID icon as available even
  // though that account never turned it on — and tapping it actually
  // authenticated as whichever account's credential was actually stored.
  // Only offer the icon when there's nothing to conflict with (the email
  // field is empty — e.g. a fresh device, or Remember Me was off) or the
  // typed/remembered email matches the account the credential actually
  // belongs to. A credential stored before `email` existed on the metadata
  // never matches a *typed* email — same fail-closed reasoning as
  // `isBiometricEnabledForCurrentUser` on AppContext.
  const storedBiometricEmail = biometricStatus.email?.trim().toLowerCase();
  const typedEmail = email.trim().toLowerCase();
  const biometricMatchesTypedAccount = !typedEmail || (!!storedBiometricEmail && storedBiometricEmail === typedEmail);

  // Immediate feedback only — the backend re-validates every signup password
  // against its own copy of this policy and is the only thing that actually
  // enforces it (see lib/passwordPolicy.ts). Not shown until something's been
  // typed, so the form doesn't open already covered in red.
  const signupPasswordCheck = password ? validatePassword(password) : null;
  const parsedSignupRate = Number(rate);
  const signupRateError = !rate.trim()
    ? "Hourly rate is required."
    : !Number.isFinite(parsedSignupRate)
      ? "Enter a valid hourly rate."
      : parsedSignupRate <= 0
        ? "Hourly rate must be greater than zero."
        : parsedSignupRate > 1000
          ? "Hourly rate cannot exceed 1000."
          : Math.abs(parsedSignupRate * 100 - Math.round(parsedSignupRate * 100)) > 1e-7
            ? "Use no more than two decimal places."
            : null;

  function switchMode(next: Mode) {
    clearAuthError();
    setRecoveryError(null);
    setRecoveryMessage(null);
    setMode(next);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (recoveryBusy || !email.trim()) return;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      const result = await requestPasswordReset(email.trim());
      // This is the backend's deliberately-neutral wording. Do not branch
      // on account existence here—the API intentionally never reveals it.
      setRecoveryMessage(result.message);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "We couldn't request a reset email. Please try again.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    void login(email, password, remember);
  }

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (signupRateError) {
      signupRateRef.current?.focus();
      signupRateRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    void signup({
      name,
      email,
      password,
      address,
      workLocationName,
      workAddress,
      multipleLocations,
      otherLocations,
      rate: parsedSignupRate,
    });
  }

  return (
    <div className="landing-shell">
      <div className="landing-hero">
        <div className="landing-shapes" aria-hidden="true">
          <span className="landing-shape landing-shape-1" />
          <span className="landing-shape landing-shape-2" />
          <span className="landing-shape landing-shape-3" />
        </div>
        <div className="landing-hero-content">
          <LandingHeroContent />
        </div>
      </div>

      {/* The auth screen had no landmark at all — no <main>, so "skip to
          main content" and landmark navigation had nothing to target. The
          hero beside it is decorative marketing copy; the form is the
          content. */}
      <main className="landing-auth-pane">
        <div className="auth-card">
          <div className="card elev-md">
            {/* Was an <h6>, sitting between the hero's <h1> and the form's
                <h3>: a level jump in both directions, and not a section
                heading in the first place — it's the product mark repeated
                above the form. A div carries the same styling with none of
                the structural claim. */}
            <div className="auth-card-topline">
              <div className="section-title auth-card-brand">
                <Logo size={22} />
                Wage Tracker
              </div>
              <span className="auth-secure-badge"><LockIcon size={12} /> Secure</span>
            </div>

            {mode !== "forgot" && (
              <div className="seg landing-mode-toggle">
                <label className="seg-opt">
                  <input type="radio" name="authmode" checked={mode === "login"} onChange={() => switchMode("login")} />
                  Log in
                </label>
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="authmode"
                    checked={mode === "signup"}
                    onChange={() => switchMode("signup")}
                  />
                  Create account
                </label>
              </div>
            )}

            {/* Only ever visible once biometric login has previously been
                enabled for this device — biometricStatus.enabled is always
                false on web/PWA (see platform/biometricAuth.ts's web
                adapter) and before Settings → Security has ever turned it
                on, so this renders nothing in either of those cases. The
                automatic cold-launch prompt (AppContext.
                attemptBiometricAuthentication) already tries this once on
                its own; this button exists for when that prompt was
                cancelled, missed, or never got a chance to run (e.g. the
                device was still on this screen when it fired).

                Also requires biometricMatchesTypedAccount — see that
                value's own comment above: without it, this offered (and
                actually signed into) whichever account's credential
                happened to occupy the device's single biometric slot,
                regardless of which account's email was typed here. */}
            {mode === "login" && biometricStatus.enabled && biometricMatchesTypedAccount && (
              <div className="auth-biometric-row">
                <button
                  type="button"
                  className="auth-biometric-btn"
                  onClick={() => void retryBiometricLogin()}
                  disabled={biometricBusy}
                  aria-label={`Sign in with ${biometryName(biometricStatus.kind ?? "none")}`}
                >
                  {biometricStatus.kind === "touchId" ? <TouchIdIcon size={22} /> : <FaceIdIcon size={22} />}
                </button>
                <span className="auth-biometric-caption">
                  {biometricBusy ? "Confirming…" : `Sign in with ${biometryName(biometricStatus.kind ?? "none")}`}
                </span>
              </div>
            )}

            {biometricLoginError && (
              <StatusBanner tone="danger" onDismiss={clearBiometricLoginError} dismissLabel="Dismiss this message">
                {biometricLoginError}
              </StatusBanner>
            )}

            {/* Was a bare `<div className="form-error">` with no role: a
                failed login announced nothing at all to a screen reader, so
                submitting and hearing silence was indistinguishable from
                the request still being in flight. */}
            {authError && (
              <StatusBanner tone="danger" onDismiss={clearAuthError} dismissLabel="Dismiss this message">
                {authError}
              </StatusBanner>
            )}

            {recoveryError && (
              <StatusBanner tone="danger" onDismiss={() => setRecoveryError(null)} dismissLabel="Dismiss this message">
                {recoveryError}
              </StatusBanner>
            )}

            {mode === "forgot" ? (
              recoveryMessage ? (
                <div key="recovery-sent" className="anim-rise">
                  <div className="auth-form-heading">
                    <span className="auth-form-eyebrow">Check your email</span>
                    <h2 className="auth-form-title">Reset instructions requested</h2>
                    <p role="status">{recoveryMessage}</p>
                  </div>
                  <p className="auth-sent-address">
                    Requested for <strong>{email.trim()}</strong>
                  </p>
                  <p className="field-hint auth-recovery-guidance">
                    For privacy, Wage Tracker shows this confirmation for every address. Check your spam folder if the
                    email does not arrive, then try again later or create an account.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    style={{ justifyContent: "center" }}
                    onClick={() => switchMode("login")}
                  >
                    Back to log in
                  </button>
                </div>
              ) : (
                <form key="forgot" className="anim-rise" onSubmit={handleForgotPassword}>
                  <div className="auth-form-heading">
                    <span className="auth-form-eyebrow">Account recovery</span>
                    <h2 className="auth-form-title">Forgot your password?</h2>
                    <p>Enter your email and we'll send a secure, single-use link for choosing a new password.</p>
                  </div>
                  <div className="field field-spaced">
                    <label htmlFor="forgot-email">Email</label>
                    <input
                      id="forgot-email"
                      className="input"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      autoFocus
                    />
                  </div>
                  <AsyncButton
                    className="btn btn-primary btn-block"
                    type="submit"
                    busy={recoveryBusy}
                    idleLabel="Send reset link"
                    busyLabel="Sending reset link…"
                    disabled={!email.trim()}
                    style={{ justifyContent: "center" }}
                  />
                  <button
                    type="button"
                    className="auth-text-link auth-text-link-block"
                    onClick={() => switchMode("login")}
                  >
                    Back to log in
                  </button>
                </form>
              )
            ) : mode === "login" ? (
              <form key="login" className="anim-rise" onSubmit={handleLogin}>
                <div className="auth-form-heading">
                  <span className="auth-form-eyebrow">Welcome back</span>
                  <h2 className="auth-form-title">Log in to your account</h2>
                  <p>Continue tracking your hours, earnings, and weekly goals.</p>
                </div>
                <div className="field field-spaced">
                  <label htmlFor="login-email">Email</label>
                  <input
                    id="login-email"
                    className="input"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="field field-spaced">
                  <div className="field-label-row">
                    <label htmlFor="login-password">Password</label>
                    <button type="button" className="auth-text-link" onClick={() => switchMode("forgot")}>
                      Forgot password?
                    </button>
                  </div>
                  <PasswordInput
                    id="login-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <label className="checkbox" style={{ marginBottom: "var(--space-3)" }}>
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="box" />
                  Remember me on this device
                </label>
                <AsyncButton className="btn btn-primary btn-block" type="submit" busy={authBusy} idleLabel="Log in" busyLabel="Signing in…" style={{ justifyContent: "center" }} />
              </form>
            ) : (
              <form key="signup" className="anim-rise" onSubmit={handleSignup}>
                <div className="auth-form-heading">
                  <span className="auth-form-eyebrow">Get started</span>
                  <h2 className="auth-form-title">Create your account</h2>
                  <p>Set up your private workspace for shifts, wages, and reports.</p>
                </div>
                <div className="field field-spaced">
                  <label htmlFor="signup-name">Full name</label>
                  <input id="signup-name" className="input" type="text" placeholder="Alex Rivera" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="field field-spaced">
                  <label htmlFor="signup-email">Email</label>
                  <input id="signup-email" className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="field field-spaced">
                  <label htmlFor="signup-password">Password</label>
                  <PasswordInput
                    id="signup-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    aria-invalid={signupPasswordCheck && !signupPasswordCheck.valid ? true : undefined}
                    aria-describedby="signup-password-hint"
                    required
                  />
                  {/* The failure used to render in the same muted grey as the
                      neutral guidance it replaced, so "your password is not
                      acceptable" looked identical to "here's what we want".
                      Now it's the danger hint style, the field is marked
                      aria-invalid, and both variants share one id so a
                      screen reader reads the reason with the field rather
                      than only if the user navigates onto the text. */}
                  {signupPasswordCheck && !signupPasswordCheck.valid ? (
                    <div id="signup-password-hint" className="field-hint field-hint-danger">
                      {signupPasswordCheck.error}
                    </div>
                  ) : (
                    <div id="signup-password-hint" className="field-hint">
                      At least {MIN_PASSWORD_LENGTH} characters — a short phrase works better than a short
                      complicated password. No symbols or numbers required.
                    </div>
                  )}
                </div>
                <div className="field field-spaced">
                  <label htmlFor="signup-rate">Hourly rate ({CURRENCY})</label>
                  <input
                    id="signup-rate"
                    ref={signupRateRef}
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 25.00"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    required
                    onInvalid={() => {
                      signupRateRef.current?.focus();
                      signupRateRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                    }}
                    aria-invalid={signupRateError ? true : undefined}
                    aria-describedby={signupRateError ? "signup-rate-error signup-rate-hint" : "signup-rate-hint"}
                  />
                  {signupRateError && <div id="signup-rate-error" className="field-hint field-hint-danger">{signupRateError}</div>}
                  <div id="signup-rate-hint" className="field-hint">Used to calculate your earnings — you can change this any time in Settings.</div>
                </div>
                <div className="field field-spaced">
                  <label htmlFor="signup-address">Your address</label>
                  <input
                    id="signup-address"
                    className="input"
                    type="text"
                    placeholder="123 Main St, Springfield"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    aria-describedby="signup-address-hint"
                  />
                  <div id="signup-address-hint" className="field-hint">Shown on your PDF reports, under your name.</div>
                </div>
                <div className="field field-spaced">
                  <label htmlFor="signup-work-location">Work location name</label>
                  <input
                    id="signup-work-location"
                    className="input"
                    type="text"
                    placeholder="Downtown Store"
                    value={workLocationName}
                    onChange={(e) => setWorkLocationName(e.target.value)}
                  />
                </div>
                <div className="field field-spaced">
                  <label htmlFor="signup-work-address">Work address</label>
                  <input
                    id="signup-work-address"
                    className="input"
                    type="text"
                    placeholder="123 Main St, Springfield"
                    value={workAddress}
                    onChange={(e) => setWorkAddress(e.target.value)}
                  />
                </div>
                <fieldset className="fieldset-plain field field-spaced">
                  <legend>Do you work multiple locations?</legend>
                  <div className="seg">
                    <label className="seg-opt">
                      <input type="radio" name="multiloc" checked={!multipleLocations} onChange={() => setMultipleLocations(false)} /> No
                    </label>
                    <label className="seg-opt">
                      <input type="radio" name="multiloc" checked={multipleLocations} onChange={() => setMultipleLocations(true)} /> Yes
                    </label>
                  </div>
                </fieldset>
                {multipleLocations && (
                  <div className="field field-spaced">
                    <label htmlFor="signup-other-locations">Other locations</label>
                    <input
                      id="signup-other-locations"
                      className="input"
                      type="text"
                      placeholder="e.g. Uptown Branch, Airport Kiosk"
                      value={otherLocations}
                      onChange={(e) => setOtherLocations(e.target.value)}
                    />
                  </div>
                )}
                <AsyncButton
                  className="btn btn-primary btn-block"
                  type="submit"
                  busy={authBusy}
                  idleLabel="Create account"
                  busyLabel="Creating account…"
                  disabled={!!signupRateError || (signupPasswordCheck ? !signupPasswordCheck.valid : false)}
                  style={{ justifyContent: "center" }}
                />
              </form>
            )}

            <div className="auth-trust-note">
              <span className="auth-trust-icon"><LockIcon size={14} /></span>
              <span><strong>Private by design</strong>Your wage data is only available in your account.</span>
            </div>

            <AuthFooter />
          </div>
        </div>
      </main>
    </div>
  );
}
