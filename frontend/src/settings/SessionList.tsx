import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import type { SessionInfo } from "../lib/api";
import { parseDeviceLabel } from "../lib/parseUserAgent";
import { AlertTriangleIcon, CheckCircleIcon, RefreshIcon } from "../components/icons";
import { StableLabel } from "../components/StableLabel";
import { SessionCard } from "./SessionCard";
import { SessionsDrawer } from "./SessionsDrawer";

/** How many devices the Settings panel shows before deferring to the drawer.
 * Three is the current device plus two — enough to recognise "yes, that's my
 * phone and my laptop" at a glance, which is the question this summary is
 * actually answering. The full audit belongs in the drawer. */
export const SUMMARY_SESSION_LIMIT = 3;

/**
 * The "Active sessions" summary in Settings → Security.
 *
 * Previously this rendered every session inline, so an account signed in on
 * a dozen devices turned the Security panel into a wall of near-identical
 * cards with the important controls stranded at the bottom. Now it shows at
 * most three and hands the rest to a dialog (see SessionsDrawer).
 *
 * Revocation is applied optimistically — the card disappears on click and
 * the server is reconciled afterwards — because the alternative is a list
 * that sits there unchanged for the length of a round trip on a cold
 * backend, which reads as "the button didn't work". If the request fails,
 * the card comes back and the error is shown; nothing is quietly swallowed.
 */
export function SessionList() {
  const { sessions, sessionsLoading, sessionsError, loadSessions, revokeSession, revokeOtherSessions } = useApp();
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Ids hidden locally while their revocation is in flight. Restored if it
   * fails; dropped once the server's own list agrees they're gone. */
  const [pendingRemoval, setPendingRemoval] = useState<string[]>([]);
  const viewAllRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the server stops returning a session, the optimistic entry has done
  // its job — clearing it here keeps the two from disagreeing indefinitely
  // if a revoke succeeded but the list was refreshed by something else.
  useEffect(() => {
    setPendingRemoval((pending) => {
      const stillPresent = pending.filter((id) => sessions.some((s) => s.id === id));
      return stillPresent.length === pending.length ? pending : stillPresent;
    });
  }, [sessions]);

  const visible = sessions.filter((s) => !pendingRemoval.includes(s.id));
  // Current device first; the backend already orders the rest newest-active
  // first, and this keeps that guarantee even if it ever stops.
  const ordered = [...visible].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  const summary = ordered.slice(0, SUMMARY_SESSION_LIMIT);
  const hiddenCount = Math.max(0, ordered.length - summary.length);

  const handleRefresh = useCallback(async () => {
    setActionError(null);
    setActionMessage(null);
    await loadSessions();
  }, [loadSessions]);

  const handleRevokeSession = useCallback(
    async (session: SessionInfo) => {
      const label = parseDeviceLabel(session.userAgent);
      setRevokingSessionId(session.id);
      setPendingRemoval((pending) => [...pending, session.id]);
      setActionError(null);
      setActionMessage(null);
      try {
        await revokeSession(session.id);
        // If that was this device's own session, revokeSession has already
        // logged the app out and this component is about to unmount.
        setActionMessage(`${label} has been logged out.`);
      } catch (e) {
        // Put it back rather than leaving a device the user believes is gone.
        setPendingRemoval((pending) => pending.filter((id) => id !== session.id));
        setActionError(e instanceof Error ? e.message : "Couldn't log out that device");
      } finally {
        setRevokingSessionId(null);
      }
    },
    [revokeSession]
  );

  const handleRevokeOthers = useCallback(async () => {
    const otherIds = sessions.filter((s) => !s.isCurrent).map((s) => s.id);
    setRevokingOthers(true);
    setPendingRemoval((pending) => [...new Set([...pending, ...otherIds])]);
    setActionError(null);
    setActionMessage(null);
    try {
      await revokeOtherSessions();
      setActionMessage("All other devices have been logged out.");
      setDrawerOpen(false);
    } catch (e) {
      setPendingRemoval((pending) => pending.filter((id) => !otherIds.includes(id)));
      setActionError(e instanceof Error ? e.message : "Couldn't log out other devices");
    } finally {
      setRevokingOthers(false);
    }
  }, [revokeOtherSessions, sessions]);

  const hasOthers = ordered.some((s) => !s.isCurrent);

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
        <div className="session-list-state">
          <div className="banner banner-danger" role="alert">
            <AlertTriangleIcon size={16} />
            <span>{sessionsError}</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleRefresh} disabled={sessionsLoading}>
            <StableLabel current={sessionsLoading ? "Retrying…" : "Try again"} longest="Retrying…" />
          </button>
        </div>
      ) : ordered.length === 0 ? (
        <div className="section-hint">No active sessions found.</div>
      ) : (
        <>
          <ul className="session-list">
            {summary.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                revoking={revokingSessionId === session.id}
                onRevoke={() => handleRevokeSession(session)}
              />
            ))}
          </ul>

          {hiddenCount > 0 && (
            <button
              ref={viewAllRef}
              type="button"
              className="btn btn-secondary btn-block session-view-all"
              onClick={() => setDrawerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
            >
              View all sessions ({ordered.length})
            </button>
          )}
        </>
      )}

      {hasOthers && (
        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={handleRevokeOthers}
          disabled={revokingOthers}
          data-confirm="Log out all other devices? Only this device will stay signed in."
          data-confirm-tone="danger"
        >
          <StableLabel
            current={revokingOthers ? "Logging out other devices…" : "Log out all other devices"}
            longest="Logging out other devices…"
          />
        </button>
      )}

      {drawerOpen && (
        <SessionsDrawer
          sessions={ordered}
          loading={sessionsLoading}
          error={sessionsError}
          revokingSessionId={revokingSessionId}
          revokingOthers={revokingOthers}
          onRefresh={handleRefresh}
          onRevokeSession={handleRevokeSession}
          onRevokeOthers={handleRevokeOthers}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
