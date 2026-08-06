import { useEffect, useRef, useState } from "react";

// How far (px) the content has to be pulled down before releasing triggers
// a refresh, and where the indicator settles while the refresh is in flight.
const PULL_THRESHOLD = 68;
// Visual cap on the *unresisted* part of the pull — past this, extra finger
// travel keeps moving the content but at a quarter of the rate, the same
// rubber-band feel used for the horizontal swipe's past-the-end resistance.
const MAX_PULL = 96;
// How far a touch has to move before we decide whether this gesture is a
// vertical pull or a horizontal one — keeps a slightly-off-axis scroll from
// being mistaken for a pull, mirroring useSwipeNav's axis lock.
const DIRECTION_LOCK = 8;

/**
 * One-finger pull-to-refresh, iOS/Android-app style — bind `containerRef` to
 * the same scrollable pane `useSwipeNav` is bound to. Only takes over the
 * gesture when it's clearly vertical, downward, *and* the pane is already
 * scrolled to the top (so it can never hijack an ordinary downward scroll
 * partway down the page). Disabled entirely via `enabled` outside the
 * screen(s) that should support it.
 *
 * Touch listeners are attached natively for the same reason as
 * useSwipeNav's: React's onTouchMove is passive by default, which would make
 * `preventDefault()` a no-op mid-gesture.
 */
export function usePullToRefresh(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onRefresh: () => Promise<void>
) {
  const [pullY, setPullY] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    let startX = 0;
    let startY = 0;
    let axis: "none" | "x" | "y" = "none";
    let active = false; // committed to a pull gesture (vertical, downward, at scrollTop 0)
    let dyLive = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      axis = "none";
      active = false;
      dyLive = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (axis === "none") {
        if (Math.abs(dx) < DIRECTION_LOCK && Math.abs(dy) < DIRECTION_LOCK) return;
        axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
        if (axis === "y" && dy > 0 && el.scrollTop <= 0) {
          active = true;
          setPulling(true);
        }
      }
      if (axis !== "y" || !active) return;

      const resisted = dy < MAX_PULL ? dy : MAX_PULL + (dy - MAX_PULL) / 4;
      dyLive = Math.max(0, resisted);
      setPullY(dyLive);
      e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!active) {
        axis = "none";
        return;
      }
      active = false;
      axis = "none";
      setPulling(false);

      if (dyLive >= PULL_THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPullY(PULL_THRESHOLD); // hold the indicator open while the fetch is in flight
        onRefresh().finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          setPullY(0);
        });
      } else {
        setPullY(0);
      }
      dyLive = 0;
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
  }, [containerRef, enabled, onRefresh]);

  // Dropping the gesture mid-flight (e.g. `enabled` flips off because the
  // user swiped to another tab while pulling) shouldn't leave the content
  // stuck translated down with no way to reset it.
  useEffect(() => {
    if (!enabled) {
      setPullY(0);
      setPulling(false);
    }
  }, [enabled]);

  return { pullY, pulling, refreshing };
}
