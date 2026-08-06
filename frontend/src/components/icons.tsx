type IconProps = { size?: number };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HomeIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 11L12 4l8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}

export function EntryIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function ReportIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 19h18" />
      <path d="M6 19v-7" />
      <path d="M12 19V6" />
      <path d="M18 19v-10" />
    </svg>
  );
}

export function HistoryIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </svg>
  );
}

export function TargetIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SettingsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 6h9" />
      <circle cx="17" cy="6" r="2" />
      <path d="M20 12H9" />
      <circle cx="6" cy="12" r="2" />
      <path d="M4 18h9" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

export function EyeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9.5 9.7a3 3 0 004.2 4.2" />
      <path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.8 7 10 7a9.6 9.6 0 004.4-1" />
      <path d="M10.6 5.2A10.4 10.4 0 0112 5c6.2 0 10 7 10 7a16.5 16.5 0 01-3.5 4.3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

/** Fuel pump — used on the per-day fuel cost toggle in the entry screen. */
export function FuelIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 21V6a2 2 0 012-2h6a2 2 0 012 2v15" />
      <path d="M3 21h12" />
      <path d="M14 10h2a2 2 0 012 2v3.5a1.5 1.5 0 003 0V9l-3-3" />
      <path d="M6 6h6" />
    </svg>
  );
}

/** Coin with a plus — used on the per-day "other earnings" toggle (tips,
 * bonuses, reimbursements — anything besides hours × rate and fuel). */
export function ExtraEarningIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="10.5" cy="13.5" r="7.5" />
      <path d="M8 13.5h5" />
      <path d="M10.5 11v5" />
      <path d="M17 4v4" />
      <path d="M15 6h4" />
    </svg>
  );
}

/** Neutral "action" badge for the confirm dialog — used for non-destructive
 * confirmations (save, log in, switch tab, etc.). */
export function CheckCircleIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

/** Warning badge for the confirm dialog — used for destructive confirmations
 * (delete, remove, clear, log out). */
export function AlertTriangleIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 3.5l9.5 16.5H2.5L12 3.5z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Exit door with an arrow — used on the top-nav log out button. */
export function LogoutIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M14.5 4.5H18a2 2 0 012 2v11a2 2 0 01-2 2h-3.5" />
      <path d="M10.5 8l-4 4 4 4" />
      <path d="M14 12H3.5" />
    </svg>
  );
}

/** Simple down chevron — used for expand/collapse affordances (rotated via
 * CSS when open, so only one icon is needed for both states). */
export function ChevronDownIcon({ size = 16, className }: IconProps & { className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Flame — used on the Home screen's current-streak stat tile. */
export function FlameIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 2.5c1 3-3.5 4.5-3.5 8.5a3.5 3.5 0 007 0c0-1.3-.6-2.1-1.1-2.9-.4.9-1.2 1.4-1.2 1.4.6-2.3-.7-4-1.2-7z" />
      <path d="M8.5 12.2A5.5 5.5 0 0012 20.5a5.5 5.5 0 003.5-9.7" />
    </svg>
  );
}

/** Trophy — used on the Home screen's best-day-this-week stat tile. */
export function TrophyIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M7 5H4v2a3 3 0 003 3" />
      <path d="M17 5h3v2a3 3 0 01-3 3" />
      <path d="M12 14v3" />
      <path d="M9 20h6" />
      <path d="M10 17h4v3h-4z" />
    </svg>
  );
}

/** GitHub brand mark — filled silhouette, used only next to the credit link. */
export function GithubIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405 1.02 0 2.04.135 3 .405 2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

/** Portfolio / website mark — a simple globe, kept in the app's stroke style. */
export function GlobeIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </svg>
  );
}
