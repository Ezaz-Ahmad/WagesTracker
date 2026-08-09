import { useEffect, useRef } from "react";
import { AlertTriangleIcon, CheckIcon } from "./icons";
import { Logo } from "./Logo";
import { StableLabel } from "./StableLabel";
import { useHealthWakeup, type HealthWakeupPhase } from "../lib/useHealthWakeup";
import { useMatchMedia } from "../lib/useMatchMedia";

const RING_SIZE = 96;
const RING_STROKE = 8;
/** The indeterminate arc covers roughly a quarter of the ring — long enough
 * to read clearly as "in motion" while spinning, short enough not to look
 * like a stalled, nearly-complete determinate bar. */
const INDETERMINATE_ARC_FRACTION = 0.26;

const RETRY_PHASES: ReadonlySet<HealthWakeupPhase> = new Set(["offline", "failed"]);

function formatElapsed(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  return `${whole} second${whole === 1 ? "" : "s"} elapsed`;
}

/** The ring's own visual center piece — an indeterminate spinning arc while
 * trying, a completed ring + checkmark once genuinely connected, and a
 * dimmed static ring for the two "stopped trying" states. Never a
 * determinate percentage while waiting: there is nothing honest to compute
 * one from (see useHealthWakeup's own docs). Purely decorative — the real
 * accessible status lives in the text region below, so this whole thing is
 * `aria-hidden`. */
function ConnectionRing({ phase, reducedMotion }: { phase: HealthWakeupPhase; reducedMotion: boolean }) {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const isConnected = phase === "connected";
  const isStopped = phase === "offline" || phase === "failed";
  const arcLength = isConnected ? c : c * INDETERMINATE_ARC_FRACTION;

  return (
    <div
      className={`connection-ring connection-ring--${phase}${reducedMotion ? " is-static" : ""}`}
      style={{ width: RING_SIZE, height: RING_SIZE }}
      aria-hidden="true"
    >
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="connection-ring-svg">
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={r}
          fill="none"
          stroke="var(--color-neutral-200)"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={r}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${c}`}
          className="connection-ring-arc"
        />
      </svg>
      {isConnected && (
        <span className="connection-ring-check">
          <CheckIcon size={30} />
        </span>
      )}
      {isStopped && (
        <span className="connection-ring-dot">
          <AlertTriangleIcon size={26} />
        </span>
      )}
    </div>
  );
}

/**
 * Shown instead of a blank screen while we wait to learn whether the user
 * is logged in, or while an explicit login/signup submission is in flight —
 * the one moment that can otherwise be a real, multi-minute wait if a
 * cold-started backend has spun down (see App.tsx's Root component).
 *
 * IMPORTANT — no fake percentage: a `/api/health` response only ever tells
 * us "hasn't answered yet" or "just answered successfully." There is no
 * genuine in-between number, so this screen never shows one. Every value on
 * screen while waiting is something we actually know: which attempt is in
 * flight and how long we've really been waiting (see useHealthWakeup). The
 * ring only ever completes and shows 100% once a real success arrives.
 */
export function WakingUpScreen() {
  const { phase, attempt, elapsedSec, retryBusy, retry } = useHealthWakeup();
  const reducedMotion = useMatchMedia("(prefers-reduced-motion: reduce)");

  const retryBtnRef = useRef<HTMLButtonElement>(null);
  // Starts at `null` (never a real phase) rather than the initial phase
  // itself, so a mount that begins *already* offline or failed still counts
  // as "just arrived at a failure state" and gets focus — not only a later
  // transition into one.
  const prevPhaseRef = useRef<HealthWakeupPhase | null>(null);
  useEffect(() => {
    const enteredFailureState = (phase === "offline" || phase === "failed") && prevPhaseRef.current !== phase;
    if (enteredFailureState) retryBtnRef.current?.focus({ preventScroll: true });
    prevPhaseRef.current = phase;
  }, [phase]);

  const heading =
    phase === "offline" ? "No internet connection" : phase === "failed" ? "Unable to connect" : "Getting Wage Tracker ready";

  const caption =
    phase === "connecting"
      ? "Connecting…"
      : phase === "waking"
        ? "Waking the server…"
        : phase === "slow"
          ? "Taking a little longer…"
          : phase === "connected"
            ? "Connected — loading your account…"
            : phase === "offline"
              ? "Check your connection and try again."
              : "We couldn't reach the server. Check your connection and try again.";

  const meta =
    phase === "connecting"
      ? "Connection attempt 1"
      : phase === "waking" || phase === "slow"
        ? `Attempt ${attempt} · ${formatElapsed(elapsedSec)}`
        : phase === "connected"
          ? "100%"
          : "";

  const showSlowHint = phase === "slow";
  const showRetry = RETRY_PHASES.has(phase);

  return (
    <div className="wakeup-shell">
      <div className="wakeup-glow" aria-hidden="true" />
      <div className="wakeup-card">
        <div className="wakeup-logo-wrap">
          <span className="wakeup-logo-halo" aria-hidden="true" />
          <Logo size={34} />
        </div>

        <ConnectionRing phase={phase} reducedMotion={reducedMotion} />

        <div className="wakeup-text" role="status" aria-live="polite" aria-label="Connecting to the Wage Tracker server">
          <h1 className="wakeup-heading">{heading}</h1>
          {/* Keyed so each distinct caption crossfades in on its own, instead
              of the text silently jumping mid-sentence. */}
          <p className="wakeup-caption" key={caption}>
            {caption}
          </p>
          {/* Always mounted (rather than conditionally rendered) and its box
              given a reserved min-height in CSS, so the one moment this
              text actually has something to say (the "slow" phase) doesn't
              grow the card or nudge anything below it — only its opacity
              changes. */}
          <p className={`wakeup-slow-hint${showSlowHint ? " is-visible" : ""}`} aria-hidden={showSlowHint ? undefined : true}>
            The server may have been idle. You can keep this screen open.
          </p>
          {/* Visually shows the real attempt/elapsed figures (and, only once
              truly connected, "100%") but is deliberately excluded from the
              accessibility tree — the meaningful phase change above is
              already announced via the live region; re-announcing an
              elapsed-seconds counter every tick would be noise, not signal. */}
          <p className="wakeup-meta" aria-hidden="true">
            {meta}
          </p>
        </div>

        {showRetry && (
          <button ref={retryBtnRef} type="button" className="btn btn-primary wakeup-retry-btn" onClick={retry} disabled={retryBusy}>
            {retryBusy && <span className="wakeup-spinner" aria-hidden="true" />}
            <StableLabel current={retryBusy ? "Retrying…" : "Retry"} longest="Retrying…" />
          </button>
        )}
      </div>
    </div>
  );
}
