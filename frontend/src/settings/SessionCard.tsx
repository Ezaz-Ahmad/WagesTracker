import type { SessionInfo } from "../lib/api";
import { parseDeviceLabel } from "../lib/parseUserAgent";
import { StableLabel } from "../components/StableLabel";

/** "Aug 15, 3:42 PM" — falls back to a plain label rather than "Invalid
 * Date" if a timestamp is ever missing or malformed. */
export function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * One device in the sessions list. Shared by the three-card summary in
 * Settings and the full list inside the drawer so the two can't drift into
 * describing the same device differently; `compact` only tightens the
 * spacing, it never removes information.
 *
 * The current device deliberately has no "Log out" button. Ending your own
 * session from a list of devices reads as a mistake far more often than an
 * intention — the Log out control in the header is the deliberate way to do
 * it, and it says so plainly.
 */
export function SessionCard({
  session,
  compact = false,
  revoking,
  onRevoke,
}: {
  session: SessionInfo;
  compact?: boolean;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const label = parseDeviceLabel(session.userAgent);

  return (
    <li
      className={`session-card card${session.isCurrent ? " is-current" : ""}${compact ? " is-compact" : ""}`}
      data-testid="session-card"
    >
      <div className="session-card-head">
        <strong className="session-card-label">{label}</strong>
        {session.isCurrent && <span className="tag tag-accent-2">This device</span>}
      </div>
      <div className="session-card-primary">Last active {formatSessionTime(session.lastActiveAt)}</div>
      <div className="session-card-secondary">
        First signed in {formatSessionTime(session.createdAt)}
        {session.ipAddress && <> · IP {session.ipAddress}</>}
      </div>
      {!session.isCurrent && (
        <button
          type="button"
          className="btn btn-secondary session-card-revoke"
          onClick={onRevoke}
          disabled={revoking}
          data-confirm={`Log out ${label}? It will need to sign in again.`}
          aria-label={`Log out ${label}`}
        >
          <StableLabel current={revoking ? "Logging out…" : "Log out"} longest="Logging out…" />
        </button>
      )}
    </li>
  );
}
