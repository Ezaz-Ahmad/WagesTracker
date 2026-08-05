import { useEffect } from "react";

/**
 * Keeps a `--app-vh` CSS custom property (an exact px value) in sync with
 * the real visible viewport height, and re-measures on every resize —
 * including Safari's toolbar showing/hiding and the on-screen keyboard
 * opening/closing.
 *
 * `100dvh` is supposed to do this on its own, but combined with
 * `position: fixed` on `<body>` (needed elsewhere to stop the whole page
 * from rubber-banding) it's unreliable on a number of iOS Safari versions:
 * the app shell's height can go stale a beat behind the actual viewport,
 * leaving a strip of bare page background exposed below the bottom nav
 * once the toolbar auto-hides. Driving the height from JS with
 * `visualViewport` (falling back to `innerHeight`) sidesteps that bug
 * entirely — a plain px value is something every browser gets right.
 */
export function useViewportHeight() {
  useEffect(() => {
    function update() {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${h}px`);
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
}
