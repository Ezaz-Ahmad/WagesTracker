import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { useCountUp } from "../lib/useCountUp";
import { fmt2 } from "../lib/date";
import { getRememberedEmail } from "../lib/api";
import { EntryIcon, ReportIcon, TargetIcon } from "../components/icons";
import { PasswordInput } from "../components/PasswordInput";
import { AppCredit } from "../components/AppCredit";
import { BubbleLoader } from "../components/BubbleLoader";
import { Logo } from "../components/Logo";

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

      <div className="landing-auth-pane">
        <div className="auth-card">
          <div className="card elev-md">
            <h6 className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Logo size={20} />
              Wage Tracker
            </h6>

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

            <AppCredit />

            {authError && <div className="form-error">{authError}</div>}

            {mode === "login" ? (
              <form key="login" className="anim-rise" onSubmit={handleLogin}>
                <h3 style={{ margin: "0 0 var(--space-3)" }}>Log in</h3>
                <div className="field field-spaced">
                  <label>Email</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="field field-spaced">
                  <label>Password</label>
                  <PasswordInput
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
                <h3 style={{ margin: "0 0 var(--space-3)" }}>Create your account</h3>
                <div className="field field-spaced">
                  <label>Full name</label>
                  <input className="input" type="text" placeholder="Alex Rivera" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="field field-spaced">
                  <label>Email</label>
                  <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="field field-spaced">
                  <label>Password</label>
                  <PasswordInput
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
                <div className="field field-spaced">
                  <label>Hourly rate ({CURRENCY})</label>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step={0.25}
                    min={0}
                    placeholder="e.g. 25.00"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                  <div className="field-hint">Used to calculate your earnings — you can change this any time in Settings.</div>
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
                  <div className="field-hint">Shown on your PDF reports, under your name.</div>
                </div>
                <div className="field field-spaced">
                  <label>Work location name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="Downtown Store"
                    value={workLocationName}
                    onChange={(e) => setWorkLocationName(e.target.value)}
                  />
                </div>
                <div className="field field-spaced">
                  <label>Work address</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="123 Main St, Springfield"
                    value={workAddress}
                    onChange={(e) => setWorkAddress(e.target.value)}
                  />
                </div>
                <div className="field field-spaced">
                  <label>Do you work multiple locations?</label>
                  <div className="seg">
                    <label className="seg-opt">
                      <input type="radio" name="multiloc" checked={!multipleLocations} onChange={() => setMultipleLocations(false)} /> No
                    </label>
                    <label className="seg-opt">
                      <input type="radio" name="multiloc" checked={multipleLocations} onChange={() => setMultipleLocations(true)} /> Yes
                    </label>
                  </div>
                </div>
                {multipleLocations && (
                  <div className="field field-spaced">
                    <label>Other locations</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. Uptown Branch, Airport Kiosk"
                      value={otherLocations}
                      onChange={(e) => setOtherLocations(e.target.value)}
                    />
                  </div>
                )}
                <button className="btn btn-primary btn-block" type="submit" disabled={authBusy} style={{ justifyContent: "center" }}>
                  {authBusy ? <BubbleLoader label="Creating your account" /> : "Create account"}
                </button>
              </form>
            )}

            <div className="auth-demo-note">Your data is private to your account.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
