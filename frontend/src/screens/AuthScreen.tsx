import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { useCountUp } from "../lib/useCountUp";
import { fmt2 } from "../lib/date";
import { getRememberedEmail } from "../lib/api";
import { EntryIcon, ReportIcon, TargetIcon } from "../components/icons";
import { PasswordInput } from "../components/PasswordInput";
import { AuthFooter } from "../components/AuthFooter";
import { BubbleLoader } from "../components/BubbleLoader";
import { Logo } from "../components/Logo";
import { StatusBanner } from "../components/StatusBanner";
import { MIN_PASSWORD_LENGTH, validatePassword } from "../lib/passwordPolicy";

type Mode = "login" | "signup";

const FEATURES = [
  {
    icon: EntryIcon,
    title: "Clock in & out",
    body: "One tap to start or end a shift, with a live running timer.",
  },
  {
    icon: TargetIcon,
    title: "Set weekly goals",
    body: "Track hours and earnings against the goals you set.",
  },
  {
    icon: ReportIcon,
    title: "Export PDF reports",
    body: "Professional weekly reports, ready to download and share.",
  },
];

function LandingPreviewCard() {
  const amount = useCountUp(647.5, 1400);
  const progress = useCountUp(82, 1400);

  return (
    <div className="landing-preview-card anim-rise" style={{ ["--i" as string]: 10 }} aria-hidden="true">
      <div className="landing-preview-kicker">This week</div>
      <div className="landing-preview-amount count-value">${fmt2(amount)}</div>
      <div className="landing-preview-trend">▲ 12% vs last week</div>
      <div className="progress-track landing-preview-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="landing-preview-caption count-value">{Math.round(progress)}% toward your weekly goal</div>
    </div>
  );
}

export function AuthScreen() {
  const { login, signup, authError, authBusy, clearAuthError } = useApp();
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

  // Immediate feedback only — the backend re-validates every signup password
  // against its own copy of this policy and is the only thing that actually
  // enforces it (see lib/passwordPolicy.ts). Not shown until something's been
  // typed, so the form doesn't open already covered in red.
  const signupPasswordCheck = password ? validatePassword(password) : null;

  function switchMode(next: Mode) {
    clearAuthError();
    setMode(next);
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    void login(email, password, remember);
  }

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    // Left blank, this falls back to the same default the app always used
    // (18.50) — the field just gives everyone the chance to set their real
    // rate up front instead of discovering it's wrong later in Settings.
    const parsedRate = parseFloat(rate);
    void signup({
      name,
      email,
      password,
      address,
      workLocationName,
      workAddress,
      multipleLocations,
      otherLocations,
      rate: Number.isFinite(parsedRate) && parsedRate >= 0 ? parsedRate : 18.5,
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
          <div className="landing-kicker anim-rise" style={{ ["--i" as string]: 0 }}>
            Wage Tracker
          </div>
          <h1 className="landing-headline anim-rise" style={{ ["--i" as string]: 2 }}>
            Track your hours.
            <br />
            Know your worth.
          </h1>
          <p className="landing-subtext anim-rise" style={{ ["--i" as string]: 4 }}>
            Clock in, log shifts, and watch your weekly earnings add up — with goal tracking and PDF reports built
            in.
          </p>
          <div className="landing-features">
            {FEATURES.map((f, i) => (
              <div className="landing-feature anim-rise" style={{ ["--i" as string]: 6 + i }} key={f.title}>
                <span className="landing-feature-icon">
                  <f.icon size={18} />
                </span>
                <div>
                  <div className="landing-feature-title">{f.title}</div>
                  <div className="landing-feature-body">{f.body}</div>
                </div>
              </div>
            ))}
          </div>
          <LandingPreviewCard />
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
            <div className="section-title auth-card-brand">
              <Logo size={20} />
              Wage Tracker
            </div>

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

            {/* Was a bare `<div className="form-error">` with no role: a
                failed login announced nothing at all to a screen reader, so
                submitting and hearing silence was indistinguishable from
                the request still being in flight. */}
            {authError && (
              <StatusBanner tone="danger" onDismiss={clearAuthError} dismissLabel="Dismiss this message">
                {authError}
              </StatusBanner>
            )}

            {mode === "login" ? (
              <form key="login" className="anim-rise" onSubmit={handleLogin}>
                <h2 className="auth-form-title">Log in</h2>
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
                  <label htmlFor="login-password">Password</label>
                  <PasswordInput
                    id="login-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <label className="checkbox" style={{ marginBottom: "var(--space-3)" }}>
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="box" />
                  Remember me on this device
                </label>
                <button className="btn btn-primary btn-block" type="submit" disabled={authBusy} style={{ justifyContent: "center" }}>
                  {authBusy ? <BubbleLoader label="Logging in" /> : "Log in"}
                </button>
              </form>
            ) : (
              <form key="signup" className="anim-rise" onSubmit={handleSignup}>
                <h2 className="auth-form-title">Create your account</h2>
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
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step={0.25}
                    min={0}
                    placeholder="e.g. 25.00"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    aria-describedby="signup-rate-hint"
                  />
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
                <button
                  className="btn btn-primary btn-block"
                  type="submit"
                  disabled={authBusy || (signupPasswordCheck ? !signupPasswordCheck.valid : false)}
                  style={{ justifyContent: "center" }}
                >
                  {authBusy ? <BubbleLoader label="Creating your account" /> : "Create account"}
                </button>
              </form>
            )}

            <div className="auth-demo-note">Your data is private to your account.</div>

            <AuthFooter />
          </div>
        </div>
      </main>
    </div>
  );
}
