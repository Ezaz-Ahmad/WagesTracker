import { useLayoutEffect, useRef, type RefObject } from "react";

/** Smoothly animates keyed children into their new positions after a reorder. */
export function useFlipAnimation<T extends HTMLElement>(dependency: string): RefObject<T> {
  const containerRef = useRef<T>(null);
  const previousRects = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-flip-key]"));
    const nextRects = new Map<string, DOMRect>();

    for (const element of elements) {
      const key = element.dataset.flipKey;
      if (key) nextRects.set(key, element.getBoundingClientRect());
    }

    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reducedMotion) {
      for (const element of elements) {
        const key = element.dataset.flipKey;
        const previous = key ? previousRects.current.get(key) : undefined;
        const next = key ? nextRects.get(key) : undefined;
        if (!previous || !next || typeof element.animate !== "function") continue;
        const deltaX = previous.left - next.left;
        const deltaY = previous.top - next.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
        element.animate(
          [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }],
          { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
        );
      }
    }
    previousRects.current = nextRects;
  }, [dependency]);

  return containerRef;
}
