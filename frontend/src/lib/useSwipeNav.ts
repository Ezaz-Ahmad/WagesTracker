import { useEffect, useRef, useState } from "react";

// How far (px) a finger has to travel before we commit to switching tabs.
const SWIPE_THRESHOLD = 60;
// How far a touch has to move before we decide whether this gesture is a
// horizontal swipe (switch tabs) or a vertical drag (scroll the screen) —
// keeps a slightly-off-axis scroll from being mistaken for a tab swipe.
const DIRECTION_LOCK = 8;
// Visual cap so a long drag doesn't fling the content off-frame before the
// tab actually changes.
const MAX_DRAG = 120;

/**
 * One-finger horizontal swipe between adjacent tabs, the way a native
 * iOS/Android app would do it. Bind `ref` to the scrollable content pane —
 * only that pane moves during the gesture, the top bar and bottom nav never
 * do. A vertical drag is left completely alone (native scroll keeps
 * working); we only take over once the gesture is clearly more horizontal
 * than vertical.
 *
 * Touch listeners are attached natively (not via React's onTouch* props)
 * because React registers touchmove as a passive listener by default, which
 * would make `preventDefault()` a no-op — and without it, an in-progress
 * horizontal swipe would also drag the page/scroll underneath it.
 */
export function useSwipeNav<T extends HTMLElement>(
  activeIndex: number,
  count: number,
  onNavigate: (index: number) => void
) {
  const ref = useRef<T | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let axis: "none" | "x" | "y" = "none";
    let dx = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      axis = "none";
      dx = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (axis === "none") {
        if (Math.abs(dx) < DIRECTION_LOCK && Math.abs(dy) < DIRECTION_LOCK) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (axis === "x") setDragging(true);
      }
      if (axis !== "x") return;

      // Rubber-band resistance past the first/last tab instead of a hard stop.
      const atStart = activeIndex === 0 && dx > 0;
      const atEnd = activeIndex === count - 1 && dx < 0;
      const resisted = atStart || atEnd ? dx / 3 : dx;
      setDragX(Math.max(-MAX_DRAG, Math.min(MAX_DRAG, resisted)));
      e.preventDefault();
    };

    const onTouchEnd = () => {
      if (axis === "x") {
        if (dx <= -SWIPE_THRESHOLD && activeIndex < count - 1) onNavigate(activeIndex + 1);
        else if (dx >= SWIPE_THRESHOLD && activeIndex > 0) onNavigate(activeIndex - 1);
      }
      axis = "none";
      dx = 0;
      setDragging(false);
      setDragX(0);
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
  }, [activeIndex, count, onNavigate]);

  return { ref, dragX, dragging };
}
