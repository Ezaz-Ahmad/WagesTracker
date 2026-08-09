import { useCallback, useEffect, useRef, useState } from "react";
import { pingHealth } from "./api";

/**
 * A `/api/health` request only ever carries two facts: it hasn't answered
 * successfully yet, or it just did. There is no "60% woken up" — any
 * percentage in between would be manufactured, not observed. This hook
 * exposes only what's actually known: which connection attempt is in
 * flight, how long we've genuinely been waiting, and a coarse phase derived
 * from those two real numbers — never a fake progress figure. Only a real
 * successful health response ever produces "connected".
 */
export type HealthWakeupPhase = "connecting" | "waking" | "slow" | "connected" | "offline" | "failed";

/** Per-attempt request timeout, in ms — matches the previous implementation. */
const PING_TIMEOUT_MS = 10000;
/** Pause between automatic retry attempts after an unsuccessful ping. */
const RETRY_DELAY_MS = 2500;
/** After this many real seconds of trying, swap in a message acknowledging
 * it's taking a while rather than silently cycling with no explanation. */
export const SLOW_AFTER_SECONDS = 50;
/** After this many real seconds with no successful response, stop the
 * automatic loop and hand control to the user via Retry rather than
 * looping forever. */
export const MAX_WAIT_SECONDS = 120;

type Status = "trying" | "connected" | "offline" | "failed";

export interface HealthWakeupState {
  phase: HealthWakeupPhase;
  /** Which connection attempt is currently in flight (or was last made). */
  attempt: number;
  /** Real elapsed seconds since the current attempt sequence started. Purely
   * observational — never fed into a percentage. */
  elapsedSec: number;
  /** True only while the Retry button's own single confirmation ping is in
   * flight — lets the button show its own busy/spinner state without the
   * rest of the UI needing to know why. */
  retryBusy: boolean;
  /** Resets the whole sequence and starts a fresh attempt. Safe to call
   * repeatedly; a call while already retrying is a no-op. */
  retry: () => void;
}

function isOnlineNow(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function useHealthWakeup(): HealthWakeupState {
  const [status, setStatus] = useState<Status>(() => (isOnlineNow() ? "trying" : "offline"));
  const [attempt, setAttempt] = useState(1);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [retryBusy, setRetryBusy] = useState(false);

  const mountedRef = useRef(true);
  const runIdRef = useRef(0);
  const startRef = useRef(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // The continuous automatic loop: one ping at a time, in sequence, until
  // success, offline, unmount, or the max-wait cutoff (enforced by the tick
  // effect below, which also aborts whatever's in flight at that point).
  // `onFirstResolved` (used by retry(), below) fires once the loop's very
  // first ping settles either way — letting the Retry button's own busy
  // state track a real request instead of a separate, redundant check.
  const runLoop = useCallback((runId: number, onFirstResolved?: () => void) => {
    (async () => {
      let n = 1;
      let first = true;
      while (runIdRef.current === runId) {
        if (!isOnlineNow()) {
          if (mountedRef.current && runIdRef.current === runId) setStatus("offline");
          if (first) onFirstResolved?.();
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        const ok = await pingHealth(PING_TIMEOUT_MS, controller.signal);
        if (first) {
          onFirstResolved?.();
          first = false;
        }
        if (runIdRef.current !== runId || !mountedRef.current) return;
        if (ok) {
          setStatus("connected");
          return;
        }
        n += 1;
        setAttempt(n);
        await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        if (runIdRef.current !== runId || !mountedRef.current) return;
      }
    })();
  }, []);

  const start = useCallback(() => {
    runIdRef.current += 1;
    const runId = runIdRef.current;
    startRef.current = Date.now();
    setAttempt(1);
    setElapsedSec(0);
    if (!isOnlineNow()) {
      setStatus("offline");
      return;
    }
    setStatus("trying");
    runLoop(runId);
  }, [runLoop]);

  // Kick off the very first attempt sequence on mount, and make sure
  // nothing from it can touch state (or fire another request) after
  // unmount — the in-flight ping's own AbortController is aborted right
  // away rather than just having its eventual result ignored.
  useEffect(() => {
    mountedRef.current = true;
    start();
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time tick: the only thing this updates is the genuine elapsed-time
  // display, plus the one time-based transition (giving up after
  // MAX_WAIT_SECONDS) — never a percentage.
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      setElapsedSec(elapsed);
      if (elapsed >= MAX_WAIT_SECONDS && statusRef.current === "trying") {
        runIdRef.current += 1;
        abortRef.current?.abort();
        setStatus("failed");
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Losing connectivity mid-attempt switches straight to the offline phase
  // (aborting whatever's in flight) instead of waiting out a doomed
  // timeout; regaining it while sitting in the offline phase automatically
  // starts a fresh attempt sequence.
  useEffect(() => {
    function handleOffline() {
      runIdRef.current += 1;
      abortRef.current?.abort();
      setStatus("offline");
    }
    function handleOnline() {
      if (statusRef.current === "offline") start();
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [start]);

  // Retry resets the whole sequence — attempt back to 1, elapsed time back
  // to 0 — immediately, then resumes the same automatic loop `start()`
  // itself would kick off. `retryBusy` (and the button's "Retrying…"
  // label/spinner) reflects that loop's first real request, clearing the
  // instant it settles either way, rather than a separate check bolted on
  // the side — so there is only ever one request in flight, never two.
  const retry = useCallback(() => {
    if (retryBusy) return;
    setRetryBusy(true);
    runIdRef.current += 1;
    const runId = runIdRef.current;
    startRef.current = Date.now();
    setAttempt(1);
    setElapsedSec(0);
    if (!isOnlineNow()) {
      setRetryBusy(false);
      setStatus("offline");
      return;
    }
    setStatus("trying");
    runLoop(runId, () => {
      if (mountedRef.current) setRetryBusy(false);
    });
  }, [retryBusy, runLoop]);

  const phase: HealthWakeupPhase =
    status === "connected" || status === "offline" || status === "failed"
      ? status
      : elapsedSec >= SLOW_AFTER_SECONDS
        ? "slow"
        : attempt <= 1
          ? "connecting"
          : "waking";

  return { phase, attempt, elapsedSec, retryBusy, retry };
}
