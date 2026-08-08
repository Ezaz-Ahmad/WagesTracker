import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { parseDeviceLabel } from "../lib/parseUserAgent";
import { AlertTriangleIcon, CheckCircleIcon, RefreshIcon } from "../components/icons";

/** "Aug 15, 3:42 PM" — falls back to a plain label rather than "Invalid
 * Date" if a timestamp is ever missing or malformed. */
function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The "Active sessions" device list — loads once on mount (and again after
 * a password change, from SecuritySettings), and exposes an explicit
 * Refresh action for anyone who wants a manual up-to-date check. The
 * current device always sorts first regardless of what order the backend
 * returns.
 */
export function SessionList() {
  const { sessions, sessionsLoading, sessionsError, loadSessions, revokeSession, revokeOtherSessions } = useApp();
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh() {
    setActionError(null);
    setActionMessage(null);
    await loadSessions();
  }

  async function handleRevokeSession(sessionId: string, label: string) {
    setRevokingSessionId(sessionId);
    setActionError(null);
    setActionMessage(null);
    try {
      await revokeSession(sessionId);
      // If that was this device's own current session, revokeSession above
      // already logged the app out and this component is about to unmount.
      setActionMessage(`${label} has been logged out.`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't log out that device");
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeOthers() {
    setRevokingOthers(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await revokeOtherSessions();
      setActionMessage("All other devices have been logged out.");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't log out other devices");
    } finally {
      setRevokingOthers(false);
    }
  }

  // Current device first, regardless of backend ordering.
  const sorted = [...sessions].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));

  return (
    <div className="session-list-wrap">
      <div className="settings-subsection-head">
        <div className="section-hint session-list-hint">
          Devices currently signed in to your account. If you don't recognize one, log it out.
        </div>
        <button type="button" className="btn btn-ghost btn-icon-label" onClick={handleRefresh} disabled={sessionsLoading}>
          <RefreshIcon size={15} />
          Refresh
        </button>
      </div>

      {actionError && (
        <div className="banner banner-danger" role="alert">
          <AlertTriangleIcon size={16} />
          <span>{actionError}</span>
        </div>
      )}
      {actionMessage && (
        <div className="banner banner-success" role="status">
          <CheckCircleIcon size={16} />
          <span>{actionMessage}</span>
        </div>
      )}

      {sessionsLoading && sessions.length === 0 ? (
        <div className="section-hint" role="status">
          Loading sessions…
        </div>
      ) : sessionsError ? (
        <div className="banner banner-danger" role="alert">
          <AlertTriangleIcon size={16} />
          <span>{sessionsError}</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="section-hint">No active sessions found.</div>
      ) : (
        <ul className="session-list">
          {sorted.map((s) => {
            const label = parseDeviceLabel(s.userAgent);
            return (
              <li key={s.id} className={`session-card card${s.isCurrent ? " is-current" : ""}`}>
                <div className="session-card-head">
                  <strong className="session-card-label">{label}</strong>
                  {s.isCurrent && <span className="tag tag-accent-2">This device</span>}
                </div>
                <div className="session-card-primary">Last active {formatSessionTime(s.lastActiveAt)}</div>
                <div className="session-card-secondary">
                  Created {formatSessionTime(s.createdAt)}
                  {s.ipAddress && <> · IP {s.ipAddress}</>}
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleRevokeSession(s.id, label)}
                    disabled={revokingSessionId === s.id}
                    data-confirm={`Log out ${label}? It will need to sign in again.`}
                    aria-label={`Log out ${label}`}
                  >
                    {revokingSessionId === s.id ? "Logging out…" : "Log out"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sessions.some((s) => !s.isCurrent) && (
        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={handleRevokeOthers}
          disabled={revokingOthers}
          data-confirm="Log out all other devices? Only this device will stay signed in."
          data-confirm-tone="danger"
        >
          {revokingOthers ? "Logging out other devices…" : "Log out all other devices"}
        </button>
      )}
    </div>
  );
}
