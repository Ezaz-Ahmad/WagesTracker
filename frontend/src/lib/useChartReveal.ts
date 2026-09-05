import { useCallback, useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Early iOS 15 cannot interpolate registered custom properties. Charts still
 * receive a smooth opacity/scale entrance there; capable engines add the
 * progressive circular sweep. */
export function supportsSmoothDonutSweep(): boolean {
  return typeof CSS !== "undefined" && "registerProperty" in CSS;
}

function shouldRevealImmediately(): boolean {
  if (typeof window === "undefined") return true;
  const reducedMotion = typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  return reducedMotion || typeof window.IntersectionObserver !== "function";
}

/**
 * Reveals one chart the first time it enters the visible viewport.
 *
 * App.tsx remounts a screen whenever its tab is revisited, so this one-shot
 * state naturally resets per visit without a timer or navigation event.
 * Deferring off-screen charts matters on phones: their animation should be
 * seen when the user reaches them, not finish while they are below the fold.
 */
export function useChartReveal<T extends Element>() {
  const [element, setElement] = useState<T | null>(null);
  const [visible, setVisible] = useState(shouldRevealImmediately);
  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (visible) return;
    if (!element) return;

    const observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, {
      threshold: 0.12,
      rootMargin: "0px 0px -4% 0px",
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [element, visible]);

  return {
    ref,
    revealClassName: `chart-reveal${visible ? " is-chart-visible" : ""}`,
  } as const;
}
