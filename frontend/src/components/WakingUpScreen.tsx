import { useEffect, useRef } from "react";
import { AlertTriangleIcon, CheckIcon } from "./icons";
import { Logo } from "./Logo";
import { AsyncButton } from "./AsyncButton";
import { useHealthWakeup, type HealthWakeupPhase } from "../lib/useHealthWakeup";
import { useMatchMedia } from "../lib/useMatchMedia";

const RING_SIZE = 96;
const RING_STROKE = 8;
/** The indeterminate arc covers roughly a quarter of the ring — long enough
 * to read clearly as "in motion" while spinning, short enough not to look
 * like a stalled, nearly-complete determinate bar. */
const INDETERMINATE_ARC_FRACTION = 0.26;

const RETRY_PHASES: ReadonlySet<HealthWakeupPhase> = new Set(["long", "offline", "failed"]);

function formatElapsed(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(whole / 60);
  const seconds = String(whole % 60).padStart(2, "0");
  return `${minutes}:${seconds} elapsed`;
}

const WAKEUP_COPY: Record<HealthWakeupPhase, { heading: string; caption: string; hint: string }> = {
  connecting: {
    heading: "Connecting securely",
    caption: "Checking your Wage Tracker service…",
    hint: "",
  },
  waking: {
    heading: "Starting your workspace",
    caption: "Your workspace was resting and is waking up.",
    hint: "A cold start can take around a minute. You can keep this screen open.",
  },
  slow: {
    heading: "Still starting",
    caption: "Your workspace is still responding.",
    hint: "This is slower than usual, but we’re continuing to try automatically.",
  },
  long: {
    heading: "Taking longer than usual",
    caption: "The service has not responded yet.",
    hint: "We’ll keep trying, or you can restart the connection below.",
  },
  connected: {
    heading: "Almost ready",
    caption: "Loading your latest shifts and account information…",
    hint: "",
  },
  offline: {
    heading: "You’re offline",
    caption: "Reconnect to the internet, then try again.",
    hint: "",
  },
  failed: {
    heading: "We couldn’t start your workspace",
    caption: "The service didn’t respond. Try again in a moment.",
    hint: "",
  },
};

const STAGES = ["Connection", "Workspace", "Account"] as const;

function stageState(phase: HealthWakeupPhase, index: number): "complete" | "current" | "pending" {
  if (phase === "connected") return index < 2 ? "complete" : "current";
  if (phase === "waking" || phase === "slow" || phase === "long") {
    return index === 0 ? "complete" : index === 1 ? "current" : "pending";
  }
  return index === 0 ? "current" : "pending";
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
 * ring only ever completes once a real success arrives.
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

  const { heading, caption, hint } = WAKEUP_COPY[phase];

  const meta =
    phase === "connecting" || phase === "waking" || phase === "slow" || phase === "long"
        ? `Attempt ${attempt} · ${formatElapsed(elapsedSec)}`
        : phase === "connected"
          ? "Service ready"
          : "";

  const showHint = hint.length > 0;
  const showRetry = RETRY_PHASES.has(phase);

  return (
    <main className="wakeup-shell">
      <div className="wakeup-glow" aria-hidden="true" />
      <div className="wakeup-card">
        <div className="wakeup-logo-wrap">
          <span className="wakeup-logo-halo" aria-hidden="true" />
          <Logo size={34} />
        </div>

        <ConnectionRing phase={phase} reducedMotion={reducedMotion} />

        <ol className="wakeup-stages" aria-hidden="true">
          {STAGES.map((stage, index) => {
            const state = stageState(phase, index);
            return (
              <li className={`is-${state}`} key={stage}>
                <span>{state === "complete" ? <CheckIcon size={12} /> : index + 1}</span>
                <small>{stage}</small>
              </li>
            );
          })}
        </ol>

        <div className="wakeup-text" role="status" aria-live="polite" aria-label="Preparing Wage Tracker">
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
          <p className={`wakeup-slow-hint${showHint ? " is-visible" : ""}`} aria-hidden={showHint ? undefined : true}>
            {hint || "Wage Tracker is preparing your workspace."}
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

        <div className="wakeup-action-slot">
          {showRetry ? (
            <AsyncButton
              ref={retryBtnRef}
              type="button"
              className="btn btn-primary wakeup-retry-btn"
              onClick={retry}
              busy={retryBusy}
              idleLabel="Retry"
              busyLabel="Retrying…"
            />
          ) : (
            <span className="wakeup-action-note" aria-hidden="true">
              {phase === "connected" ? "Finishing up…" : "Preparing automatically — no action needed"}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
