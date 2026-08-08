import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lets a modal/popup play a CSS exit animation before it actually unmounts.
 * Without this, a conditionally-rendered overlay (`{open && <Modal/>}`) gets
 * a nice entrance animation for free (the browser always runs a keyframe
 * animation on mount) but vanishes instantly on close — React just rips the
 * node out the moment `open` flips, with no chance for a fade/scale-out to
 * play. That asymmetry is what makes a popup read as "not smooth" even when
 * its entrance is carefully animated.
 *
 * Usage: call `requestClose(actuallyClose)` instead of calling `actuallyClose`
 * (your state setter / callback prop) directly. This flips `closing` to
 * true — add a matching `is-closing` class in CSS with an exit keyframe —
 * then waits `ms` before invoking `actuallyClose`, at which point the
 * element is already visually gone and unmounting it is invisible. Skips the
 * wait entirely (same as `ms <= 0`) when the OS's reduced-motion setting is
 * on — the CSS exit animation itself already collapses to near-instant under
 * `prefers-reduced-motion` (see animations.css), so waiting out the old,
 * un-reduced `ms` here would just be a pause with nothing visibly happening.
 */
export function useDismissTransition(ms = 200) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const requestClose = useCallback(
    (onClosed: () => void) => {
      if (closingRef.current) return; // already closing — ignore a second trigger
      closingRef.current = true;
      const prefersReducedMotion =
        typeof window !== "undefined" && typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
          : false;
      if (ms <= 0 || prefersReducedMotion) {
        onClosed();
        return;
      }
      setClosing(true);
      timer.current = setTimeout(() => {
        onClosed();
        // Only matters if this instance survives the close (e.g. ConfirmProvider,
        // which reuses one hook across many popups) — a component that unmounts
        // itself on close won't be around to see this reset, which is fine.
        closingRef.current = false;
        setClosing(false);
      }, ms);
    },
    [ms]
  );

  return { closing, requestClose };
}
