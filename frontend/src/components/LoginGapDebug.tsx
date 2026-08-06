import { useEffect, useState } from "react";

/** TEMPORARY diagnostic overlay — not a real feature. Shows a live readout
 * of viewport/shell measurements for a few seconds right after login, so
 * the actual numbers on a real device can be captured (screenshotted) when
 * a fix can't be verified by testing in a desktop browser. Remove once the
 * bottom-nav-gap-on-login bug is confirmed fixed. */
export function LoginGapDebug() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const start = performance.now();

    const sample = (tag: string) => {
      const nav = document.querySelector(".app-bottomnav");
      const shell = document.querySelector(".app-shell");
      const main = document.querySelector(".app-main");
      const navRect = nav?.getBoundingClientRect();
      const shellRect = shell?.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect();
      const vv = window.visualViewport;
      const t = Math.round(performance.now() - start);
      const line =
        `[${tag}] t=${t}ms win=${window.innerHeight} vv=${vv ? Math.round(vv.height) : "n/a"}` +
        ` shell=${shellRect ? Math.round(shellRect.height) : "n/a"}` +
        ` main=${mainRect ? Math.round(mainRect.height) : "n/a"}` +
        ` navTop=${navRect ? Math.round(navRect.top) : "n/a"} navBot=${navRect ? Math.round(navRect.bottom) : "n/a"}`;
      setLines((prev) => [...prev, line].slice(-16));
    };

    sample("mount");
    const timers = [50, 150, 300, 500, 800, 1200, 2000, 3500, 5000].map((ms) =>
      setTimeout(() => sample(`t${ms}`), ms)
    );

    const onTouch = () => sample("touchstart");
    const onScroll = () => sample("scroll");
    const onVvResize = () => sample("vv-resize");
    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", onVvResize);

    const cleanupAt = setTimeout(() => {
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", onVvResize);
    }, 9000);

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(cleanupAt);
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", onVvResize);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: "max(env(safe-area-inset-top, 0px), 6px)",
        left: 4,
        right: 4,
        zIndex: 9999,
        background: "rgba(0,0,0,0.85)",
        color: "#5cff5c",
        fontFamily: "monospace",
        fontSize: 9,
        lineHeight: 1.4,
        padding: "6px 8px",
        borderRadius: 8,
        pointerEvents: "none",
        maxHeight: "44vh",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
      }}
    >
      {lines.join("\n")}
    </div>
  );
}
