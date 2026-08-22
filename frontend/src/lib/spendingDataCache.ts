import { useCallback, useEffect, useSyncExternalStore } from "react";
import * as api from "./api";
import type { SpendingCategory, SpendingSummary } from "./types";

/**
 * A summary remains fresh for ordinary tab navigation for one minute. The
 * cache is still explicitly invalidated after every mutation that can change
 * spending or the earnings comparison, so this timeout is only the
 * background-revalidation policy, not a correctness boundary.
 */
export const SPENDING_SUMMARY_FRESH_MS = 60_000;
export const SPENDING_CATEGORIES_FRESH_MS = 5 * 60_000;

export interface SpendingDataState<T> {
  data: T | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  updatedAt: number | null;
}

interface CacheEntry<T> {
  scope: string;
  snapshot: SpendingDataState<T>;
  listeners: Set<() => void>;
  inFlight: Promise<T> | null;
}

const summaries = new Map<string, CacheEntry<SpendingSummary>>();
const categories = new Map<string, CacheEntry<SpendingCategory[]>>();

function createEntry<T>(scope: string): CacheEntry<T> {
  return {
    scope,
    snapshot: { data: null, loading: false, stale: true, error: null, updatedAt: null },
    listeners: new Set(),
    inFlight: null,
  };
}

function summaryKey(scope: string, from: string, to: string): string {
  return `${scope}\u0000${from}\u0000${to}`;
}

function getSummaryEntry(scope: string, from: string, to: string): CacheEntry<SpendingSummary> {
  const key = summaryKey(scope, from, to);
  let entry = summaries.get(key);
  if (!entry) {
    entry = createEntry(scope);
    summaries.set(key, entry);
  }
  return entry;
}

function getCategoryEntry(scope: string): CacheEntry<SpendingCategory[]> {
  let entry = categories.get(scope);
  if (!entry) {
    entry = createEntry(scope);
    categories.set(scope, entry);
  }
  return entry;
}

function publish<T>(entry: CacheEntry<T>, patch: Partial<SpendingDataState<T>>): void {
  entry.snapshot = { ...entry.snapshot, ...patch };
  for (const listener of entry.listeners) listener();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function loadSummaryEntry(
  entry: CacheEntry<SpendingSummary>,
  from: string,
  to: string
): Promise<SpendingSummary> {
  if (entry.inFlight) return entry.inFlight;
  publish(entry, { loading: true, error: null });
  const request = api.getSpendingSummary(from, to)
    .then((result) => {
      publish(entry, { data: result, loading: false, stale: false, error: null, updatedAt: Date.now() });
      return result;
    })
    .catch((error: unknown) => {
      // A failed background refresh must never evict usable data. Mark the
      // attempt settled so it does not spin in a retry loop; a manual retry,
      // app resume, or later invalidation can try again.
      publish(entry, {
        loading: false,
        stale: false,
        error: errorMessage(error, "Couldn't load spending summary."),
      });
      throw error;
    })
    .finally(() => {
      entry.inFlight = null;
    });
  entry.inFlight = request;
  return request;
}

async function loadCategoryEntry(entry: CacheEntry<SpendingCategory[]>): Promise<SpendingCategory[]> {
  if (entry.inFlight) return entry.inFlight;
  publish(entry, { loading: true, error: null });
  const request = api.listSpendingCategories(true)
    .then((result) => {
      publish(entry, { data: result.categories, loading: false, stale: false, error: null, updatedAt: Date.now() });
      return result.categories;
    })
    .catch((error: unknown) => {
      publish(entry, {
        loading: false,
        stale: false,
        error: errorMessage(error, "Couldn't load spending categories."),
      });
      throw error;
    })
    .finally(() => {
      entry.inFlight = null;
    });
  entry.inFlight = request;
  return request;
}

function needsLoad<T>(state: SpendingDataState<T>, maxAgeMs: number): boolean {
  if (state.loading || state.error) return false;
  if (!state.data || state.stale || state.updatedAt === null) return true;
  return Date.now() - state.updatedAt >= maxAgeMs;
}

export function useSpendingSummary(scope: string, from: string, to: string, enabled = true) {
  const entry = getSummaryEntry(scope, from, to);
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }, [entry]);
  const getSnapshot = useCallback(() => entry.snapshot, [entry]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled || !needsLoad(state, SPENDING_SUMMARY_FRESH_MS)) return;
    void loadSummaryEntry(entry, from, to).catch(() => {});
  }, [enabled, entry, from, to, state]);

  const refresh = useCallback(
    () => loadSummaryEntry(entry, from, to),
    [entry, from, to]
  );
  return { ...state, refresh };
}

export function useSpendingCategories(scope: string, enabled = true) {
  const entry = getCategoryEntry(scope);
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }, [entry]);
  const getSnapshot = useCallback(() => entry.snapshot, [entry]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled || !needsLoad(state, SPENDING_CATEGORIES_FRESH_MS)) return;
    void loadCategoryEntry(entry).catch(() => {});
  }, [enabled, entry, state]);

  const refresh = useCallback(() => loadCategoryEntry(entry), [entry]);
  return { ...state, refresh };
}

/** Mark cached summaries stale without deleting their last good values. Any
 * mounted consumer revalidates in the background; an unmounted range waits
 * until it is shown again. */
export function invalidateSpendingSummaries(scope?: string): void {
  for (const entry of summaries.values()) {
    if (scope !== undefined && entry.scope !== scope) continue;
    publish(entry, { stale: true, error: null });
  }
}

export function invalidateSpendingCategories(scope?: string): void {
  for (const entry of categories.values()) {
    if (scope !== undefined && entry.scope !== scope) continue;
    publish(entry, { stale: true, error: null });
  }
}

/** Account boundaries must discard financial data rather than retaining it
 * in module memory for the next login. */
export function clearSpendingDataCache(scope?: string): void {
  for (const [key, entry] of summaries) {
    if (scope === undefined || entry.scope === scope) summaries.delete(key);
  }
  for (const [key, entry] of categories) {
    if (scope === undefined || entry.scope === scope) categories.delete(key);
  }
}

/** Test-only reset kept explicit so isolated component tests never inherit a
 * previous test's session cache. */
export function resetSpendingDataCacheForTests(): void {
  summaries.clear();
  categories.clear();
}
