import { useEffect, useRef } from "react";
import type { SessionInfo } from "../lib/api";
import { CloseIcon, RefreshIcon } from "../components/icons";
import { Skeleton } from "../components/Skeleton";
import { StableLabel } from "../components/StableLabel";
import { StatusBanner } from "../components/StatusBanner";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
import { SessionCard } from "./SessionCard";

/**
 * "All active sessions" — the full device list, moved out of the Settings
 * panel and into a dialog.
 *
 * The panel version was an unbounded vertical list: with a dozen sessions it
 * pushed everything else off screen and buried the actions underneath it.
 * Here the list scrolls inside its own pane while the title and the
 * "log out all other devices" action stay put, so the number of devices no
 * longer changes the shape of the screen.
 *
 * On phones it's a bottom sheet (thumb-reachable, and the natural iOS idiom);
 * from the tablet breakpoint up it becomes a centred modal rather than a
 * sheet stretched across a wide screen. That's one component either way —
 * see `.sessions-drawer` in styles/settings.css.
 *
 * Accessibility is delegated, not reimplemented: `useFocusTrap` handles the
 * focus trap, the initial focus move, Escape, and restoring focus to
 * whatever opened this (the "View all sessions" button) on close;
 * `useDismissTransition` collapses the open/close animation to nothing under
 * `prefers-reduced-motion`.
 */
export function SessionsDrawer({
  sessions,
  loading,
  error,
  actionError,
  actionMessage,
  revokingSessionId,
  revokingOthers,
  onRefresh,
  onRevokeSession,
  onRevokeOthers,
  onClose,
}: {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  /** Result of a revoke started from inside this dialog. Owned by
   * SessionList (which performs the request) but rendered here, because
   * while this dialog is open its backdrop hides everything else. */
  actionError: string | null;
  actionMessage: string | null;
  revokingSessionId: string | null;
  revokingOthers: boolean;
  onRefresh: () => void;
  onRevokeSession: (session: SessionInfo) => void;
  onRevokeOthers: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { closing, requestClose } = useDismissTransition(220);

  const dismiss = () => requestClose(onClose);

  // Escape is wired through the trap so there's exactly one key handler and
  // one definition of "this dialog is open".
  useFocusTrap(true, dismiss, closeButtonRef);

  // The page behind must not scroll while a sheet is over it — otherwise
  // flicking the list at its end drags the Settings screen underneath.
  // Restored exactly to whatever was there before, rather than assumed to be
  // "" (Settings may have set its own).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const others = sessions.filter((s) => !s.isCurrent);
  const hasOthers = others.length > 0;
  // A refresh with the list already populated keeps the list on screen and
  // animates the glyph, instead of tearing the list down and letting the
  // sheet's height collapse and snap back.
  const refreshing = loading && sessions.length > 0;

  return (
    <div className={`sessions-drawer-backdrop${closing ? " is-closing" : ""}`} onClick={dismiss}>
      <div
        ref={panelRef}
        className={`sessions-drawer${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sessions-drawer-title"
        aria-describedby="sessions-drawer-count"
        // The backdrop closes on click; the panel must not, or every tap
        // inside the dialog would dismiss it.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sessions-drawer-grabber" aria-hidden="true" />

        <div className="sessions-drawer-head">
          <div className="sessions-drawer-heading">
            <h2 id="sessions-drawer-title" className="sessions-drawer-title">
              All active sessions
            </h2>
            <p id="sessions-drawer-count" className="section-hint">
              {sessions.length === 1 ? "1 device is" : `${sessions.length} devices are`} signed in to your account.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost sessions-drawer-icon-btn"
            onClick={onRefresh}
            disabled={loading}
            aria-label={refreshing ? "Refreshing the session list" : "Refresh the session list"}
            aria-busy={refreshing || undefined}
            title="Refresh"
          >
            <span className={`refresh-glyph${refreshing ? " is-spinning" : ""}`} aria-hidden="true">
              <RefreshIcon size={16} />
            </span>
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            className="btn btn-ghost sessions-drawer-icon-btn"
            onClick={dismiss}
            aria-label="Close all active sessions"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="sessions-drawer-body">
          {actionError && <StatusBanner tone="danger">{actionError}</StatusBanner>}
          {actionMessage && <StatusBanner tone="success">{actionMessage}</StatusBanner>}

          {error ? (
            <div className="sessions-drawer-state">
              <StatusBanner tone="danger">{error}</StatusBanner>
              <button type="button" className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
                <StableLabel current={loading ? "Retrying…" : "Try again"} longest="Retrying…" />
              </button>
            </div>
          ) : loading && sessions.length === 0 ? (
            <div className="session-list-skeleton" role="status" aria-label="Loading your active sessions">
              <Skeleton className="session-card-skeleton" />
              <Skeleton className="session-card-skeleton" />
              <Skeleton className="session-card-skeleton" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="sessions-drawer-state section-hint">No active sessions found.</div>
          ) : (
            <ul className="session-list session-list-compact">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  compact
                  revoking={revokingSessionId === session.id}
                  onRevoke={() => onRevokeSession(session)}
                />
              ))}
            </ul>
          )}
        </div>

        {hasOthers && (
          // Pinned outside the scrolling pane: the most consequential action
          // here shouldn't require scrolling past twelve devices to reach.
          <div className="sessions-drawer-actions">
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={onRevokeOthers}
              disabled={revokingOthers}
              data-confirm="Log out all other devices? Only this device will stay signed in."
              data-confirm-tone="danger"
            >
              <StableLabel
                current={revokingOthers ? "Logging out other devices…" : `Log out ${others.length} other device${others.length === 1 ? "" : "s"}`}
                longest="Logging out other devices…"
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
