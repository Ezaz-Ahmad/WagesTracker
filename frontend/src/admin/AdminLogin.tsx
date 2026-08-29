import { useState } from "react";
import { AdminApiError, adminLogin } from "./adminApi";
import { PasswordInput } from "../components/PasswordInput";
import { Logo } from "../components/Logo";
import { AsyncButton } from "../components/AsyncButton";

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
          <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Logo size={20} />
            Wage Tracker — Admin
          </div>
          <form onSubmit={handleSubmit} className="anim-rise">
            <h1 style={{ margin: "0 0 var(--space-3)" }}>Admin login</h1>
            {error && <div className="form-error">{error}</div>}
            <div className="field field-spaced">
              <label htmlFor="admin-password">Admin password</label>
              <PasswordInput
                id="admin-password"
                placeholder="••••••••"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <AsyncButton className="btn btn-primary btn-block" type="submit" busy={busy} idleLabel="Log in" busyLabel="Checking…" style={{ justifyContent: "center" }} />
          </form>
          <div className="auth-demo-note">Not a regular account — a separate admin-only password.</div>
        </div>
      </div>
    </div>
  );
}
