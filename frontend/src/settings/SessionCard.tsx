import type { SessionInfo } from "../lib/api";
import { parseDeviceKind, parseDeviceLabel, type DeviceKind } from "../lib/parseUserAgent";
import { MonitorIcon, SmartphoneIcon, TabletIcon } from "../components/icons";
import { StableLabel } from "../components/StableLabel";

/** "Aug 15, 3:42 PM" — falls back to a plain label rather than "Invalid
 * Date" if a timestamp is ever missing or malformed. */
export function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const KIND_ICON: Record<DeviceKind, typeof MonitorIcon> = {
  phone: SmartphoneIcon,
  tablet: TabletIcon,
  desktop: MonitorIcon,
  // A UA we can't classify is far more likely to be some desktop browser we
  // don't have a substring for than an exotic form factor, and a monitor is
  // the least surprising thing to draw when we're guessing.
  unknown: MonitorIcon,
};

/**
 * One device in the sessions list. Shared by the three-card summary in
 * Settings and the full list inside the drawer so the two can't drift into
 * describing the same device differently; `compact` only tightens the
 * spacing, it never removes information.
 *
 * Information hierarchy, deliberately three levels deep:
 *   1. Device name + a silhouette glyph, and "This device" if it's you.
 *   2. Last active — the thing you actually scan for when you're checking
 *      whether a session is still in use.
 *   3. First signed in, and the IP, on their own quieter line. The IP is
 *      real evidence when something looks wrong, and noise the other 99% of
 *      the time, so it sits at the bottom of the card in the smallest type
 *      rather than sharing a line with the sign-in time as it used to.
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
  const Icon = KIND_ICON[parseDeviceKind(session.userAgent)];

  return (
    <li
      className={`session-card card${session.isCurrent ? " is-current" : ""}${compact ? " is-compact" : ""}`}
      data-testid="session-card"
    >
      <div className="session-card-head">
        {/* aria-hidden: the glyph only restates the device label sitting
            immediately next to it, so announcing it would be repetition. */}
        <span className="session-card-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <strong className="session-card-label">{label}</strong>
        {session.isCurrent && <span className="tag tag-accent-2 session-card-badge">This device</span>}
      </div>
      <div className="session-card-primary">Last active {formatSessionTime(session.lastActiveAt)}</div>
      <div className="session-card-secondary">First signed in {formatSessionTime(session.createdAt)}</div>
      {session.ipAddress && <div className="session-card-tertiary">IP {session.ipAddress}</div>}
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
