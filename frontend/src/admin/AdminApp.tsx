import { useCallback, useState } from "react";
import { AdminApiError, clearAdminToken, getAdminToken, setAdminToken } from "./adminApi";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";
import "./admin.css";

export function AdminApp() {
  const [token, setTokenState] = useState<string | null>(() => getAdminToken());

  const handleLoggedIn = useCallback((t: string) => {
    setAdminToken(t);
    setTokenState(t);
  }, []);

  const handleLogout = useCallback(() => {
    clearAdminToken();
    setTokenState(null);
  }, []);

  // Shared by the dashboard: a 401 partway through a session (expired token) drops back to
  // the login screen instead of surfacing a confusing error. Returns true if it handled it.
  const handleAuthError = useCallback(
    (e: unknown) => {
      if (e instanceof AdminApiError && e.status === 401) {
        handleLogout();
        return true;
      }
      return false;
    },
    [handleLogout]
  );

  if (!token) return <AdminLogin onLoggedIn={handleLoggedIn} />;
  return <AdminDashboard onLogout={handleLogout} onAuthError={handleAuthError} />;
}
