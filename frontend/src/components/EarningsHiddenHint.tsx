import { useApp } from "../context/AppContext";
import { EyeIcon } from "./icons";

/**
 * A small pointer that shows up right next to a masked amount whenever the
 * app-wide privacy toggle (the eye icon in the top nav) is hiding earnings —
 * without it, a first-time (or just forgetful) user sees a blurred "••••"
 * with no clue why, or how to fix it. Tapping the hint itself also reveals
 * earnings directly, same as the nav button, so it's a shortcut as much as
 * an explanation.
 *
 * Always mounted — visibility is driven entirely by a CSS grid-rows collapse
 * (the `is-open` class; see .earnings-hint-collapse in app.css, the same
 * technique the day-accordion cards use). An earlier version of this
 * mounted/unmounted the element on a timer instead, and it looked cheap:
 * the instant React added or removed the node, its margin/height entered or
 * left the layout in a single frame, so everything below it in the card
 * would visibly hop into its new position rather than easing there —
 * animating the fade alone doesn't stop the surrounding layout from
 * jumping. Animating the *height* to zero instead means the freed space
 * eases open/shut over the same transition as the fade, so nothing shakes.
 */
export function EarningsHiddenHint({ className }: { className?: string }) {
  const { earningsHidden, revealEarnings } = useApp();
  return (
    <div className={`earnings-hint-collapse${earningsHidden ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <div className="earnings-hint-wrap">
        <button type="button" className="earnings-hint" onClick={revealEarnings} tabIndex={earningsHidden ? 0 : -1}>
          <EyeIcon size={12} />
          Tap the eye icon above — or tap here — to view your earnings
        </button>
      </div>
    </div>
  );
}
