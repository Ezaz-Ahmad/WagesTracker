import { useEffect, useRef, useState } from "react";

// How far (px) an upward drag has to travel before releasing counts as a
// completed swipe, mirroring usePullToRefresh's PULL_THRESHOLD for the same
// "far enough to mean it" feel, just in the opposite direction.
const SWIPE_THRESHOLD = 70;
// Visual cap on the unresisted part of the drag — same rubber-band idea as
// usePullToRefresh's MAX_PULL, so a finger dragged well past the threshold
// doesn't keep translating the content 1:1 off the top of the screen.
const MAX_DRAG = 140;
// How far a touch has to move before committing to an axis, exactly
// mirroring usePullToRefresh/useSwipeNav's own DIRECTION_LOCK — keeps a
// slightly-off-axis touch from being mistaken for a deliberate swipe.
const DIRECTION_LOCK = 8;

/**
 * One-finger swipe-up gesture — bind `ref` to the full-screen surface that
 * should respond to it (see WelcomeScreen). Purely a progressive
 * enhancement: every caller must also offer an ordinary button that does
 * the same thing `onComplete` does, since a swipe gesture alone is neither
 * discoverable nor reachable by keyboard/switch-control/screen-reader
 * navigation. Only takes over the gesture once it's clearly a vertical,
 * upward drag, so it can never hijack an ordinary tap or a horizontal
 * gesture on the same surface.
 *
 * Touch listeners are attached natively (not via React's onTouchMove) for
 * the same reason as useSwipeNav/usePullToRefresh: React's synthetic touch
 * handlers are passive by default, which would make `preventDefault()` a
 * no-op mid-gesture.
 */
export function useSwipeUp<T extends HTMLElement>(enabled: boolean, onComplete: () => void) {
  const ref = useRef<T | null>(null);
  // How far up the content should visually track the finger right now — 0
  // at rest, growing as the drag progresses, purely cosmetic (a subtle
  // "lifting away" effect) and always reset to 0 on release regardless of
  // outcome, since the actual dismissal is a full screen change, not a
  // settled scroll position.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startX = 0;
    let startY = 0;
    let axis: "none" | "x" | "y" = "none";
    let active = false;
    let dyLive = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      axis = "none";
      active = false;
      dyLive = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (axis === "none") {
        if (Math.abs(dx) < DIRECTION_LOCK && Math.abs(dy) < DIRECTION_LOCK) return;
        axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
        if (axis === "y" && dy < 0) {
          active = true;
          setDragging(true);
        }
      }
      if (axis !== "y" || !active) return;

      const upDistance = -dy;
      const resisted = upDistance < MAX_DRAG ? upDistance : MAX_DRAG + (upDistance - MAX_DRAG) / 4;
      dyLive = Math.max(0, resisted);
      setDragY(dyLive);
      e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!active) {
        axis = "none";
        return;
      }
      active = false;
      axis = "none";
      setDragging(false);
      setDragY(0);
      const completed = dyLive >= SWIPE_THRESHOLD;
      dyLive = 0;
      if (completed) onCompleteRef.current();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled]);

  return { ref, dragY, dragging };
}
