import type { ReactNode } from "react";
import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, InfoIcon } from "./icons";

export type StatusTone = "success" | "warning" | "danger" | "info";

const TONE_ICON = {
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  danger: AlertTriangleIcon,
  info: InfoIcon,
} as const;

interface StatusBannerProps {
  tone: StatusTone;
  children: ReactNode;
  /** Renders a real dismiss button. Omit for banners that clear themselves
   * (a save confirmation) or that describe a condition the user has to fix. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  /** Overrides the tone's default live-region role. Use sparingly — the
   * defaults are right almost always. */
  role?: "alert" | "status";
}

/**
 * The app's single status-message component: success, warning, danger and
 * informational notices, everywhere.
 *
 * Before this existed the app had two competing treatments. `.banner` (used
 * inside Settings) paired an icon with text, had rounded corners and a
 * semantic live-region role. `.form-error` (used for the login error, the
 * PDF download error, and the top-level action error — arguably the three
 * most important messages in the product) was a bare square box with no
 * icon, and two of the three were dismissed by an `onClick` on the `<div>`
 * itself: no button, no keyboard path, no hint that clicking did anything.
 *
 * Three things are deliberate here:
 *
 *  - **Icon plus text, always.** Nothing in the app conveys state by colour
 *    alone, which matters for the ~1 in 12 men with a colour vision
 *    deficiency and for anyone reading a phone screen in daylight.
 *  - **Role follows tone, not the caller.** `danger` interrupts with
 *    `role="alert"`; everything else uses the polite `role="status"`, so a
 *    "Saved" confirmation never talks over what a screen reader user is
 *    already listening to. A caller can override, but shouldn't need to.
 *  - **Dismissal is a real button** with a 44x44 hit area (WCAG 2.5.5),
 *    tucked back into the banner's padding so honouring that minimum
 *    doesn't make every banner taller.
 */
export function StatusBanner({ tone, children, onDismiss, dismissLabel = "Dismiss", className, role }: StatusBannerProps) {
  const Icon = TONE_ICON[tone];
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");

  return (
    <div className={`banner banner-${tone}${className ? ` ${className}` : ""}`} role={resolvedRole}>
      <Icon size={16} />
      <span className="banner-text">{children}</span>
      {onDismiss && (
        <button type="button" className="banner-dismiss" onClick={onDismiss} aria-label={dismissLabel}>
          <CloseIcon size={15} />
        </button>
      )}
    </div>
  );
}
