import { useEffect, useRef, useState, type RefObject } from "react";

const PULL_THRESHOLD = 68;
const MAX_PULL = 96;
const DIRECTION_LOCK = 14;
const VERTICAL_CONFIDENCE = 1.25;

/**
 * Pull-to-refresh for the Home scroll pane.
 *
 * Live touch distance is written only to the small refresh indicator, once
 * per animation frame. The scroll pane and page content are never translated,
 * and React state changes only when a refresh actually starts or finishes.
 */
export function usePullToRefresh(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onRefresh: () => Promise<void>
) {
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    let startX = 0;
    let startY = 0;
    let axis: "none" | "x" | "y" = "none";
    let active = false;
    let dyLive = 0;
    let rafId: number | null = null;
    let pendingDistance: number | null = null;

    const applyFrame = () => {
      rafId = null;
      if (pendingDistance === null) return;
      const distance = pendingDistance;
      pendingDistance = null;
      const indicator = indicatorRef.current;
      if (!indicator) return;
      const shownDistance = Math.min(distance, PULL_THRESHOLD);
      indicator.style.opacity = String(Math.min(1, distance / 34));
      indicator.style.transform = `translate3d(-50%, ${shownDistance}px, 0) scale(${Math.min(1, 0.72 + distance / 160)})`;
    };

    const scheduleFrame = (distance: number) => {
      pendingDistance = distance;
      if (rafId === null) rafId = requestAnimationFrame(applyFrame);
    };

    const resetIndicator = (animated: boolean) => {
      const indicator = indicatorRef.current;
      if (!indicator) return;
      indicator.style.transition = animated
        ? "opacity 180ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1)"
        : "none";
      indicator.style.willChange = animated ? "" : "transform, opacity";
      scheduleFrame(0);
    };

    const resetGesture = () => {
      axis = "none";
      active = false;
      dyLive = 0;
    };

    const onTouchStart = (event: TouchEvent) => {
      resetGesture();
      if (refreshingRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (axis === "none") {
        if (Math.max(absX, absY) < DIRECTION_LOCK) return;
        if (absX >= absY) axis = "x";
        else if (absY >= absX * VERTICAL_CONFIDENCE) axis = "y";
        else return;

        if (axis === "y" && dy > 0 && el.scrollTop <= 0) {
          active = true;
          const indicator = indicatorRef.current;
          if (indicator) {
            indicator.style.transition = "none";
            indicator.style.willChange = "transform, opacity";
          }
        }
      }
      if (axis !== "y" || !active) return;
      if (dy <= 0) {
        dyLive = 0;
        scheduleFrame(0);
        return;
      }

      const resisted = dy < MAX_PULL ? dy : MAX_PULL + (dy - MAX_PULL) / 4;
      dyLive = Math.max(0, resisted);
      scheduleFrame(dyLive);
      event.preventDefault();
    };

    const finish = (commit: boolean) => {
      if (!active) {
        resetGesture();
        return;
      }
      const shouldRefresh = commit && dyLive >= PULL_THRESHOLD;
      resetGesture();

      if (!shouldRefresh) {
        resetIndicator(true);
        return;
      }

      scheduleFrame(PULL_THRESHOLD);
      refreshingRef.current = true;
      setRefreshing(true);
      void onRefreshRef.current().finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        resetIndicator(true);
      });
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
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerRef, enabled]);

  useEffect(() => {
    if (enabled) return;
    const indicator = indicatorRef.current;
    if (!indicator) return;
    indicator.style.opacity = "0";
    indicator.style.transform = "translate3d(-50%, 0, 0) scale(.72)";
    indicator.style.transition = "none";
    indicator.style.willChange = "";
  }, [enabled]);

  return { indicatorRef, refreshing };
}
