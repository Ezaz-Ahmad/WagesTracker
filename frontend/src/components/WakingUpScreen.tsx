import { useEffect, useRef, useState } from "react";
import { pingHealth } from "../lib/api";
import { GoalRing } from "./GoalRing";
import { Logo } from "./Logo";

/** How long the eased progress takes to visually settle near its cap — tuned
 * to roughly match a typical Render free-tier cold start (well under a
 * minute), so the bar's pace feels honest rather than either racing ahead of
 * reality or crawling long after the server's actually back. */
const EASE_SECONDS = 35;
/** The eased fill never claims 100% on its own — only a real successful ping
 * does that. This cap is how close it's allowed to get while still waiting. */
const EASE_CAP = 96;
/** After this long, swap in a message acknowledging it's taking a while,
 * rather than silently sitting at ~96% with no explanation. */
const SLOW_AFTER_SECONDS = 75;

/** Shown in place of a blank screen while we wait to find out whether the
 * user is logged in — the one moment that can otherwise be a real, multi-
 * minute wait if Render's free-tier instance has spun down. The percentage
 * is a genuine signal, not just decoration: it only reaches 100 once a
 * real ping to /api/health succeeds, at which point the parent's own
 * session check (already in flight) is expected to resolve moments later
 * and swap this screen out for the real one. */
export function WakingUpScreen() {
  const [percent, setPercent] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [ready, setReady] = useState(false);
  const startRef = useRef(Date.now());

  // Eased fill — a smooth, ever-slowing climb toward (but never reaching)
  // the cap, purely to give a sense of real motion between actual pings.
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      setElapsedSec(elapsed);
      const eased = EASE_CAP * (1 - Math.exp(-elapsed / EASE_SECONDS));
      setPercent((prev) => (prev >= 100 ? prev : Math.max(prev, Math.min(EASE_CAP, eased))));
    }, 200);
    return () => clearInterval(id);
  }, []);

  // The real signal: keep pinging /api/health until it actually answers.
  // Each attempt gets its own timeout so a stalled connection doesn't hang
  // the whole loop — a fresh attempt starts right after, still reaching the
  // same waking-up server.
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    async function loop() {
      while (!cancelled) {
        const ok = await pingHealth(10000);
        if (cancelled) return;
        if (ok) {
          setPercent(100);
          setReady(true);
          return;
        }
        await new Promise<void>((resolve) => {
          retryTimer = setTimeout(resolve, 2500);
        });
      }
    }

    void loop();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, []);

  // Kept deliberately generic — this screen covers both a silent auto-login
  // check and an explicit login/signup submission, so it never assumes
  // which one is in flight.
  const caption = ready
    ? "Connected — just a moment…"
    : elapsedSec > SLOW_AFTER_SECONDS
      ? "Still going — a cold start can occasionally take a couple of minutes."
      : elapsedSec < 8
        ? "Connecting…"
        : percent < 80
          ? "Waking up the server — this can take a minute if it's been idle."
          : "Almost there…";

  return (
    <div className="wakeup-shell">
      <div className="wakeup-glow" aria-hidden="true" />
      <div className="wakeup-card">
        <div className="wakeup-logo-wrap">
          <span className="wakeup-logo-halo" aria-hidden="true" />
          <Logo size={34} />
        </div>
        <GoalRing pct={percent} value={`${Math.round(percent)}%`} size={148} strokeWidth={10} />
        {/* Keyed so each distinct message crossfades in on its own, instead
            of the text silently jumping mid-sentence. */}
        <p className="wakeup-caption" key={caption}>
          {caption}
        </p>
      </div>
    </div>
  );
}
