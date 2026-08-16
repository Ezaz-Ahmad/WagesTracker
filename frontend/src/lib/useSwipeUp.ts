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
// The same settle curve WelcomeScreen used to apply itself via inline style
// — now owned entirely by this hook (see below for why).
const SETTLE_TRANSITION = "transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms cubic-bezier(0.22, 1, 0.36, 1)";

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
 *
 * Unlike usePullToRefresh (a small indicator re-rendering on every pixel of
 * travel is cheap), this drives the transform/opacity of a full-screen
 * surface with the app's entire marketing content underneath it — routing
 * that through React state on every `touchmove` (which can fire well over
 * 60 times/sec) means a render + reconciliation pass per pixel of finger
 * travel, which is exactly what turns a swipe into a laggy one on a
 * mid-range phone. So the live part of the gesture bypasses React
 * entirely: touchmove writes straight to the bound element's own style,
 * batched to one paint per animation frame via requestAnimationFrame.
 * React only gets involved at the two edges of the gesture — `dragging`
 * flips true/false once each, for callers that want to react to it (e.g.
 * dimming a hint while actively dragging) — never mid-drag.
 */
export function useSwipeUp<T extends HTMLElement>(enabled: boolean, onComplete: () => void) {
  const ref = useRef<T | null>(null);
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
    let rafId: number | null = null;
    let pendingDy: number | null = null;

    // The one place that actually touches the DOM mid-gesture — coalesced
    // to at most once per frame, so a burst of touchmove events between two
    // frames collapses into a single style write instead of one each.
    const applyFrame = () => {
      rafId = null;
      if (pendingDy === null) return;
      const dy = pendingDy;
      pendingDy = null;
      el.style.transform = dy > 0 ? `translateY(-${dy}px)` : "";
      // A slight fade as it's dragged away, capped well short of fully
      // transparent, so the gesture reads as "lifting the screen off"
      // rather than a bare translate with nothing else responding to it.
      el.style.opacity = dy > 0 ? String(1 - Math.min(dy / MAX_DRAG, 1) * 0.35) : "";
    };

    const scheduleFrame = (dy: number) => {
      pendingDy = dy;
      if (rafId === null) rafId = requestAnimationFrame(applyFrame);
    };

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
          el.style.transition = "none";
          // Promoted to its own compositor layer only while a drag is
          // actually happening — see the cleanup in settle() below for why
          // this isn't left on permanently.
          el.style.willChange = "transform, opacity";
          setDragging(true);
        }
      }
      if (axis !== "y" || !active) return;

      const upDistance = -dy;
      const resisted = upDistance < MAX_DRAG ? upDistance : MAX_DRAG + (upDistance - MAX_DRAG) / 4;
      dyLive = Math.max(0, resisted);
      scheduleFrame(dyLive);
      e.preventDefault();
    };

    const settle = (completed: boolean) => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingDy = null;
      el.style.transition = SETTLE_TRANSITION;
      el.style.transform = "";
      el.style.opacity = "";
      setDragging(false);
      // `will-change` is a hint for the drag itself; keeping it set forever
      // costs the browser a standing compositor layer for no benefit once
      // the gesture is over. Cleared once the settle transition (or, if
      // `completed`, the screen unmounting) has actually finished, not
      // immediately, so it doesn't cut the settle animation's own last
      // frame short.
      const clearWillChange = () => {
        el.style.willChange = "";
      };
      el.addEventListener("transitionend", clearWillChange, { once: true });
      window.setTimeout(clearWillChange, 360);
      if (completed) onCompleteRef.current();
    };

    const onTouchEnd = () => {
      if (!active) {
        axis = "none";
        return;
      }
      active = false;
      axis = "none";
      const completed = dyLive >= SWIPE_THRESHOLD;
      dyLive = 0;
      settle(completed);
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
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [enabled]);

  return { ref, dragging };
}
