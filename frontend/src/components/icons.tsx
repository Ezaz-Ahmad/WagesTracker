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

/** Wallet/receipt mark for the personal Spending workspace. */
export function SpendingIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 6.5A2.5 2.5 0 016.5 4H18a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6.5z" />
      <path d="M4 8h16M15 13h5" />
      <circle cx="15" cy="13" r=".7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlusIcon({ size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M12 5v14M5 12h14" /></svg>;
}

export function EditIcon({ size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M4 20l4.2-1 10-10a2.1 2.1 0 00-3-3l-10 10L4 20zM13.8 7.4l3 3" /></svg>;
}

export function TrashIcon({ size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
}

/** Safe glyph renderer for persisted category icon identifiers. The backend
 * accepts the same closed allow-list, so stored data can never become SVG or
 * HTML injected by a user. */
export function CategoryGlyph({ icon, size = 18 }: IconProps & { icon: string }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", ...base };
  switch (icon) {
    case "dining": return <svg {...common}><path d="M7 3v7M4 3v5a3 3 0 006 0V3M7 10v11M16 3v18M16 3c3 2 3 7 0 9" /></svg>;
    case "groceries": return <svg {...common}><path d="M3 5h2l2 11h10l2-8H6M9 20h.01M16 20h.01" /></svg>;
    case "transport": return <svg {...common}><path d="M5 16l1-8h12l1 8M4 16h16v3h-2M6 19H4v-3M7 12h10M8 8l1-3h6l1 3" /></svg>;
    case "housing": return <svg {...common}><path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6" /></svg>;
    case "bills": return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" /></svg>;
    case "shopping": return <svg {...common}><path d="M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 016 0v2" /></svg>;
    case "health": return <svg {...common}><path d="M12 20S4 15 4 9a4 4 0 017-2.6L12 8l1-1.6A4 4 0 0120 9c0 6-8 11-8 11z" /></svg>;
    case "entertainment": return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 9l6 3-6 3V9z" /></svg>;
    case "education": return <svg {...common}><path d="M3 9l9-5 9 5-9 5-9-5zM7 12v5c3 2 7 2 10 0v-5M21 9v6" /></svg>;
    case "family": return <svg {...common}><circle cx="9" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M3 20c.7-4 3-6 6-6s5.3 2 6 6M14 15c3 0 5 1.7 6 5" /></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>;
  }
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

/** Map pin — used by the Entry screen's work-location picker and trigger. */
export function LocationPinIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M20 10c0 5.5-8 11-8 11S4 15.5 4 10a8 8 0 1116 0z" />
      <circle cx="12" cy="10" r="2.5" />
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

/** Plain checkmark, no enclosing circle — used as a brief "that registered"
 * flash over the sign-in/out button, which is already circular itself. */
export function CheckIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M5 13l4.5 4.5L19 7" />
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

/** Circular refresh arrows — used on the Home screen's pull-to-refresh indicator. */
export function RefreshIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M20 11A8 8 0 105.5 16.5" />
      <path d="M20 5v6h-6" />
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

/** Simple person silhouette — used on the "Profile & preferences" Settings
 * category row. */
export function UserIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c1.2-3.8 4.3-6 7.5-6s6.3 2.2 7.5 6" />
    </svg>
  );
}

/** Briefcase — used on the "Work & pay" Settings category row. */
export function BriefcaseIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="3" y="8" width="18" height="11" rx="2" />
      <path d="M8 8V6a2 2 0 012-2h4a2 2 0 012 2v2" />
      <path d="M3 13h18" />
    </svg>
  );
}

/** Padlock — used on the "Security" Settings category row. */
export function LockIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M7.5 10.5V7a4.5 4.5 0 019 0v3.5" />
      <circle cx="12" cy="15.2" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Stacked database cylinder — used on the "Data & account" Settings
 * category row. */
export function DatabaseIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
      <path d="M4.5 12v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" />
    </svg>
  );
}

/** Simple right-pointing chevron — used as the navigation affordance on
 * Settings category rows. Built as its own icon (rather than rotating
 * ChevronDownIcon via CSS like the Settings back button does) so its
 * "chevron" identity is explicit at the call site. */
export function ChevronRightIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CloseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** The informational tone's glyph (StatusBanner) — deliberately a distinct
 * shape from CheckCircleIcon and AlertTriangleIcon so the three tones are
 * distinguishable without relying on their colours. */
export function InfoIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.75v.5" />
    </svg>
  );
}

/* — device-kind glyphs for the Security → active sessions list. Three
   silhouettes rather than three labels: at card scale the shape is what the
   eye actually uses to sort "my phone" from "my laptop", and the written
   label ("Safari on iOS") is right beside it for anyone who needs the
   words. All three are aria-hidden at the call site — they repeat
   information the adjacent text already carries. */
export function SmartphoneIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.75 18.5h2.5" />
    </svg>
  );
}

export function TabletIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

export function MonitorIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </svg>
  );
}

/** Download affordance on History's per-week PDF button. A tray with an
 * arrow into it, rather than a document glyph — the action is "save this to
 * your device", and the button's own label already says PDF. */
export function DownloadIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 3v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </svg>
  );
}

/** Face ID's own corner-bracket-and-face glyph — used in Settings → Security
 * and on the login screen whenever the device's detected biometry kind is
 * "faceId" (see AppContext.biometricCapabilities/biometricStatus). Kept
 * visually distinct from TouchIdIcon so the two are never confused in a
 * screenshot or at a glance. */
export function FaceIdIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M18 4h2a2 2 0 0 1 2 2v2" />
      <path d="M22 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M6 20H4a2 2 0 0 1-2-2v-2" />
      <path d="M9 10v1" />
      <path d="M15 10v1" />
      <path d="M9 15.5c.8.8 1.9 1.2 3 1.2s2.2-.4 3-1.2" />
      <path d="M12 9v4h-1" />
    </svg>
  );
}

/** Touch ID's fingerprint glyph — shown instead of FaceIdIcon whenever the
 * detected biometry kind is "touchId" (older/smaller iPhones without a
 * TrueDepth camera). */
export function TouchIdIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 4a8 8 0 0 1 8 8v2" />
      <path d="M4 14v-2a8 8 0 0 1 4-6.93" />
      <path d="M12 8a4 4 0 0 1 4 4v3" />
      <path d="M8 15v-3a4 4 0 0 1 1.5-3.12" />
      <path d="M12 11v4.5a2.5 2.5 0 0 0 2.5 2.5" />
    </svg>
  );
}
