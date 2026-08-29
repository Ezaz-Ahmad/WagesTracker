import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import type { SessionInfo } from "../lib/api";
import { parseDeviceLabel } from "../lib/parseUserAgent";
import { RefreshIcon } from "../components/icons";
import { Skeleton } from "../components/Skeleton";
import { StableLabel } from "../components/StableLabel";
import { StatusBanner } from "../components/StatusBanner";
import { SessionCard } from "./SessionCard";
import { AsyncButton } from "../components/AsyncButton";
import { SessionsDrawer } from "./SessionsDrawer";

/** How many devices the Settings panel shows before deferring to the drawer.
 * Three is the current device plus two — enough to recognise "yes, that's my
 * phone and my laptop" at a glance, which is the question this summary is
 * actually answering. The full audit belongs in the drawer. */
export const SUMMARY_SESSION_LIMIT = 3;

/** Sort key for "most recently active". A malformed or missing timestamp
 * sorts last rather than throwing the whole comparator into NaN territory,
 * where the result would depend on the array's original order. */
function lastActiveMs(session: SessionInfo): number {
  const t = new Date(session.lastActiveAt).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

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
  // Current device first, then the rest strictly by most recent activity.
  //
  // The second half used to be left to the backend's own ORDER BY, with a
  // comment saying so. That made the *product* requirement — the summary
  // shows this device plus the two most recently active others — depend on
  // an ordering guarantee that lives in another repo layer, is invisible
  // from here, and would degrade silently into "three arbitrary devices" if
  // that query ever changed. Sorting here as well costs nothing on a list
  // this size and makes the guarantee testable where it's actually claimed.
  const ordered = [...visible].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return Number(b.isCurrent) - Number(a.isCurrent);
    return lastActiveMs(b) - lastActiveMs(a);
  });
  const summary = ordered.slice(0, SUMMARY_SESSION_LIMIT);
  const hiddenCount = Math.max(0, ordered.length - summary.length);
  // A refresh with sessions already on screen: the list stays put and the
  // control says what it's doing, rather than the list emptying and
  // reflowing everything under it.
  const refreshing = sessionsLoading && sessions.length > 0;

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
        <button
          type="button"
          className="btn btn-ghost btn-icon-label"
          onClick={handleRefresh}
          disabled={sessionsLoading}
          aria-busy={refreshing || undefined}
        >
          <span className={`refresh-glyph${refreshing ? " is-spinning" : ""}`} aria-hidden="true">
            <RefreshIcon size={15} />
          </span>
          {/* StableLabel keeps the control exactly as wide in both states, so
              a refresh never nudges the heading beside it. */}
          <StableLabel current={refreshing ? "Refreshing…" : "Refresh"} longest="Refreshing…" />
        </button>
      </div>

      {/* Suppressed while the drawer is open — it renders the same two
          messages itself, and mounting both would put identical text in two
          live regions at once, which a screen reader announces twice. The
          drawer owns this feedback for as long as it's covering the panel. */}
      {!drawerOpen && actionError && <StatusBanner tone="danger">{actionError}</StatusBanner>}
      {!drawerOpen && actionMessage && <StatusBanner tone="success">{actionMessage}</StatusBanner>}

      {sessionsLoading && sessions.length === 0 ? (
        // Skeleton rather than a line of text: the real list is about to
        // occupy roughly this much space, so the panel doesn't jump when it
        // arrives.
        <div className="session-list-skeleton" role="status" aria-label="Loading your active sessions">
          <Skeleton className="session-card-skeleton" />
          <Skeleton className="session-card-skeleton" />
        </div>
      ) : sessionsError ? (
        <div className="session-list-state">
          <StatusBanner tone="danger">{sessionsError}</StatusBanner>
          <AsyncButton type="button" className="btn btn-secondary" onClick={handleRefresh} busy={sessionsLoading} idleLabel="Try again" busyLabel="Retrying…" />
        </div>
      ) : ordered.length === 0 ? (
        // Reaching this means the request succeeded and came back empty,
        // which shouldn't be possible while you're reading it — you are a
        // session. Say so plainly and offer the way out, rather than
        // presenting a dead end as a normal state.
        <div className="session-list-empty">
          <div className="session-list-empty-title">No devices to show</div>
          <p className="section-hint session-list-empty-body">
            You're signed in right now, so at least this device should be listed. Refreshing usually sorts it out.
          </p>
          <AsyncButton type="button" className="btn btn-secondary" onClick={handleRefresh} busy={sessionsLoading} idleLabel="Refresh" busyLabel="Refreshing…" />
        </div>
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
        <AsyncButton
          type="button"
          className="btn btn-danger btn-block"
          onClick={handleRevokeOthers}
          busy={revokingOthers}
          idleLabel="Log out all other devices"
          busyLabel="Logging out other devices…"
          data-confirm="Log out all other devices? Only this device will stay signed in."
          data-confirm-tone="danger"
        />
      )}

      {drawerOpen && (
        <SessionsDrawer
          sessions={ordered}
          loading={sessionsLoading}
          error={sessionsError}
          // Without these two, a revoke that failed *inside* the drawer set
          // its message on this component — which is behind a modal backdrop
          // — so the card silently reappeared and nothing explained why. The
          // drawer is a full modal; while it's open it has to own the
          // feedback for the actions it offers.
          actionError={actionError}
          actionMessage={actionMessage}
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
