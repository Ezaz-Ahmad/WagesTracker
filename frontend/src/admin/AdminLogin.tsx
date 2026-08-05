import { useState } from "react";
import { AdminApiError, adminLogin } from "./adminApi";

export function AdminLogin({ onLoggedIn }: { onLoggedIn: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await adminLogin(password);
      onLoggedIn(token);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Couldn't log in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="card elev-md">
          <h6 className="section-title">Wage Tracker — Admin</h6>
          <form onSubmit={handleSubmit} className="anim-rise">
            <h3 style={{ margin: "0 0 var(--space-3)" }}>Admin login</h3>
            {error && <div className="form-error">{error}</div>}
            <div className="field field-spaced">
              <label>Admin password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
              {busy ? "Checking…" : "Log in"}
            </button>
          </form>
          <div className="auth-demo-note">Not a regular account — a separate admin-only password.</div>
        </div>
      </div>
    </div>
  );
}
