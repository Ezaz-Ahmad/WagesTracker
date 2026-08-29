import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let nowMs = Date.now();
let interval: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let visibilityListenerAttached = false;

function publishTick(): void {
  nowMs = Date.now();
  tickCount += 1;
  for (const listener of listeners) listener();
}

function stopInterval(): void {
  if (interval === null) return;
  clearInterval(interval);
  interval = null;
}

function startInterval(): void {
  if (interval !== null || listeners.size === 0 || (typeof document !== "undefined" && document.hidden)) return;
  nowMs = Date.now();
  interval = setInterval(publishTick, 1000);
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    stopInterval();
    return;
  }
  publishTick();
  startInterval();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!visibilityListenerAttached && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  }
  startInterval();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopInterval();
      if (visibilityListenerAttached) {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        visibilityListenerAttached = false;
      }
    }
  };
}

function getSnapshot(): number {
  return nowMs;
}

const subscribeNever = () => () => {};
const inactiveSnapshot = () => 0;

/**
 * One shared clock for every live shift value. Multiple tiny subscribers
 * (elapsed timer, live earnings, glance chart) receive the same tick without
 * creating overlapping intervals.
 */
export function useLiveNow(active: boolean): number {
  const subscribeForState = useCallback(
    (listener: Listener) => active ? subscribe(listener) : subscribeNever(),
    [active]
  );
  return useSyncExternalStore(
    subscribeForState,
    active ? getSnapshot : inactiveSnapshot,
    inactiveSnapshot
  );
}

export function getLiveClockDiagnostics() {
  return { subscribers: listeners.size, running: interval !== null, tickCount };
}

export function resetLiveClockForTests(): void {
  stopInterval();
  if (visibilityListenerAttached && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = false;
  }
  listeners.clear();
  nowMs = Date.now();
  tickCount = 0;
}
