import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query's current match state in JS, kept in sync with
 * viewport/setting changes via the standard MediaQueryList change event
 * (falling back to the older addListener/removeListener pair for older
 * WebKit). Used where a component needs to make the *same* breakpoint or
 * preference decision CSS is already making (e.g. "are we currently showing
 * the desktop two-column Settings layout, or the mobile single-column one")
 * so the two never drift out of sync with each other.
 */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari < 14 / older WebKit only.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}
