import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let nowMs = Date.now();
let interval: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

function publishTick(): void {
  nowMs = Date.now();
  tickCount += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (interval === null) {
    nowMs = Date.now();
    interval = setInterval(publishTick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
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
  if (interval !== null) clearInterval(interval);
  interval = null;
  listeners.clear();
  nowMs = Date.now();
  tickCount = 0;
}
