import { useState } from "react";
import { useApp } from "../context/AppContext";

type Mode = "login" | "signup";

export function AuthScreen() {
  const { login, signup, authError, authBusy, clearAuthError } = useApp();
  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workLocationName, setWorkLocationName] = useState("");
  const [workAddress, setWorkAddress] = useState("");
  const [multipleLocations, setMultipleLocations] = useState(false);
  const [otherLocations, setOtherLocations] = useState("");

  function switchMode(next: Mode) {
    clearAuthError();
    setMode(next);
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    void login(email, password);
  }

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    void signup({ name, email, password, workLocationName, workAddress, multipleLocations, otherLocations });
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="card elev-md">
          <h6 className="section-title">Wage Tracker</h6>

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
                <input
                  className="input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary btn-block" type="submit" disabled={authBusy} style={{ justifyContent: "center" }}>
                {authBusy ? "Logging in…" : "Log in"}
              </button>
              <div className="auth-footnote">
                New here?{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); switchMode("signup"); }}>
                  Create an account
                </a>
              </div>
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
                <input
                  className="input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
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
                {authBusy ? "Creating account…" : "Create account"}
              </button>
              <div className="auth-footnote">
                Already have an account?{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); switchMode("login"); }}>
                  Log in
                </a>
              </div>
            </form>
          )}

          <div className="auth-demo-note">Your data is private to your account.</div>
          <div className="app-credit">
            Built by Ezaz Ahmad ·{" "}
            <a href="https://github.com/Ezaz-Ahmad" target="_blank" rel="noopener noreferrer">
              github.com/Ezaz-Ahmad
            </a>{" "}
            ·{" "}
            <a href="https://ezazahmad.com" target="_blank" rel="noopener noreferrer">
              ezazahmad.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
