import { useEffect, useRef } from "react";

// Navigation is intentionally committed only when the finger is released.
// The page itself never follows the finger: keeping the live gesture out of
// React and off the full content tree is considerably more stable on iOS.
const SWIPE_THRESHOLD = 72;
const DIRECTION_LOCK = 14;
const HORIZONTAL_CONFIDENCE = 1.55;

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='tab']",
  "[contenteditable='true']",
  "[data-swipe-nav-ignore]",
].join(",");

/**
 * One-finger navigation between adjacent app tabs.
 *
 * The hook only observes the gesture until touchend. It never puts a live
 * distance into React state and never transforms the page, so ordinary
 * scrolling (including slightly diagonal scrolling) cannot nudge the app
 * panel sideways. A gesture must become decisively horizontal before it can
 * navigate, and gestures that start on controls are left to those controls.
 */
export function useSwipeNav<T extends HTMLElement>(
  activeIndex: number,
  count: number,
  onNavigate: (index: number) => void
) {
  const ref = useRef<T | null>(null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let axis: "none" | "x" | "y" = "none";
    let dxLive = 0;
    let dyLive = 0;
    let blocked = false;

    const reset = () => {
      axis = "none";
      dxLive = 0;
      dyLive = 0;
      blocked = false;
    };

    const onTouchStart = (event: TouchEvent) => {
      reset();
      if (event.touches.length !== 1) {
        blocked = true;
        return;
      }
      const target = event.target;
      blocked = target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));
      if (blocked) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (blocked || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (axis === "none") {
        if (Math.max(absX, absY) < DIRECTION_LOCK) return;
        // Vertical intent wins early; ambiguous diagonals remain unclaimed.
        if (absY >= absX) axis = "y";
        else if (absX >= absY * HORIZONTAL_CONFIDENCE) axis = "x";
        else return;
      }
      if (axis !== "x") return;

      // A gesture can start horizontally and then turn into a scroll. Once
      // the final movement is vertically dominant, permanently yield it back
      // instead of navigating on the stale early horizontal distance.
      if (absY > absX) {
        axis = "y";
        dxLive = 0;
        dyLive = dy;
        return;
      }

      dxLive = dx;
      dyLive = dy;
      // Once a deliberate horizontal gesture is confirmed, stop WebKit from
      // treating the remainder as a rubber-band/page-pan gesture.
      event.preventDefault();
    };

    const finish = (commit: boolean) => {
      if (commit && axis === "x" && Math.abs(dxLive) >= Math.abs(dyLive) * HORIZONTAL_CONFIDENCE) {
        if (dxLive <= -SWIPE_THRESHOLD && activeIndex < count - 1) onNavigateRef.current(activeIndex + 1);
        else if (dxLive >= SWIPE_THRESHOLD && activeIndex > 0) onNavigateRef.current(activeIndex - 1);
      }
      reset();
    };

    const onTouchEnd = () => finish(true);
    const onTouchCancel = () => finish(false);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [activeIndex, count]);

  return { ref };
}
