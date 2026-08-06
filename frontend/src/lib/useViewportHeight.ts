import { useEffect } from "react";

/**
 * Keeps a `--app-vh` CSS custom property (an exact px value) in sync with
 * the real full-screen viewport height, so the app shell (locked to
 * `position: fixed` at the body level to stop pull-to-refresh bounce) always
 * covers exactly the visible screen — no gap of bare page background left
 * below the bottom nav, no content cut off underneath.
 *
 * Two iOS quirks made plain `100dvh` unreliable here:
 *  1. Combined with a `position: fixed` body, `dvh` can go stale a beat
 *     behind the real viewport as Safari's chrome shows/hides.
 *  2. In standalone "Add to Home Screen" mode, `visualViewport.height` can
 *     under-report versus `window.innerHeight` — it seems to exclude the
 *     translucent status-bar strip, which our full-bleed shell still needs
 *     to extend under. Taking the larger of the two avoids that shortfall
 *     (and comes with a mild upside: when the keyboard opens, the shell
 *     doesn't shrink to chase `visualViewport` — `.app-main`'s own
 *     scrolling, plus the browser's native "scroll focused input into
 *     view", handles that instead).
 *
 * Also re-measures a couple of times just after mount and on resume from
 * background, since a standalone PWA's WKWebView can report a transitional
 * size on cold launch, before settling to its final full-screen dimensions.
 */
export function useViewportHeight() {
  useEffect(() => {
    function update() {
      const vv = window.visualViewport?.height ?? 0;
      const h = Math.max(window.innerHeight, vv);
      document.documentElement.style.setProperty("--app-vh", `${h}px`);
    }

    update();
    // Catch the WKWebView settling to its final size right after a
    // standalone cold launch, when the first measurement can be transitional.
    const settleTimers = [requestAnimationFrame(update), window.setTimeout(update, 60), window.setTimeout(update, 300)];

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    window.visualViewport?.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(settleTimers[0] as number);
      window.clearTimeout(settleTimers[1] as number);
      window.clearTimeout(settleTimers[2] as number);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
}
