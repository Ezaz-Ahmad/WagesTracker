import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Screen } from "../lib/types";

export const HOME_WIDGET_IDS = [
  "week-summary",
  "today-shift",
  "spending",
  "week-glance",
  "days-logged",
  "weeks-on-goal",
  "current-streak",
  "best-day",
] as const;

export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number];

export const HOME_WIDGET_DETAILS: Record<HomeWidgetId, { label: string; description: string }> = {
  "week-summary": { label: "Week summary", description: "Earnings, hours and goal progress" },
  "today-shift": { label: "Today's shift", description: "Clock in, clock out and current shift" },
  spending: { label: "Personal spending", description: "Monthly spending snapshot" },
  "week-glance": { label: "Week at a glance", description: "Daily hours chart and shift details" },
  "days-logged": { label: "Days logged", description: "Days worked this week" },
  "weeks-on-goal": { label: "Weeks on goal", description: "Goal consistency over time" },
  "current-streak": { label: "Current streak", description: "Consecutive days worked" },
  "best-day": { label: "Best day", description: "Highest earning day this week" },
};

export const DEFAULT_TAB_ORDER: readonly Screen[] = ["home", "entry", "spending", "report", "history", "settings"];

export const TAB_LABELS: Record<Screen, string> = {
  home: "Home",
  entry: "Entry",
  spending: "Spending",
  report: "Report",
  history: "History",
  settings: "Settings",
};

export interface LayoutPreferences {
  homeWidgetOrder: HomeWidgetId[];
  hiddenHomeWidgets: HomeWidgetId[];
  tabOrder: Screen[];
}

interface LayoutPreferencesContextValue extends LayoutPreferences {
  moveHomeWidget: (id: HomeWidgetId, targetVisibleIndex: number) => void;
  setHomeWidgetVisible: (id: HomeWidgetId, visible: boolean) => void;
  moveTab: (id: Screen, targetIndex: number) => void;
  resetHome: () => void;
  resetTabs: () => void;
}

const DEFAULT_PREFERENCES: LayoutPreferences = {
  homeWidgetOrder: [...HOME_WIDGET_IDS],
  hiddenHomeWidgets: [],
  tabOrder: [...DEFAULT_TAB_ORDER],
};

const noop = () => {};
const LayoutPreferencesContext = createContext<LayoutPreferencesContextValue>({
  ...DEFAULT_PREFERENCES,
  moveHomeWidget: noop,
  setHomeWidgetVisible: noop,
  moveTab: noop,
  resetHome: noop,
  resetTabs: noop,
});

function normaliseOrder<T extends string>(candidate: unknown, defaults: readonly T[]): T[] {
  const allowed = new Set<string>(defaults);
  const result: T[] = [];
  if (Array.isArray(candidate)) {
    for (const value of candidate) {
      if (typeof value === "string" && allowed.has(value) && !result.includes(value as T)) result.push(value as T);
    }
  }
  for (const value of defaults) if (!result.includes(value)) result.push(value);
  return result;
}

function normaliseSubset<T extends string>(candidate: unknown, allowedValues: readonly T[]): T[] {
  if (!Array.isArray(candidate)) return [];
  const allowed = new Set<string>(allowedValues);
  const result: T[] = [];
  for (const value of candidate) {
    if (typeof value === "string" && allowed.has(value) && !result.includes(value as T)) result.push(value as T);
  }
  return result;
}

export function parseLayoutPreferences(raw: string | null): LayoutPreferences {
  if (!raw) return { ...DEFAULT_PREFERENCES, homeWidgetOrder: [...HOME_WIDGET_IDS], hiddenHomeWidgets: [], tabOrder: [...DEFAULT_TAB_ORDER] };
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutPreferences>;
    const homeWidgetOrder = normaliseOrder(parsed.homeWidgetOrder, HOME_WIDGET_IDS);
    const hiddenCandidates = normaliseSubset(parsed.hiddenHomeWidgets, HOME_WIDGET_IDS);
    const hiddenHomeWidgets = hiddenCandidates.filter((id) => homeWidgetOrder.includes(id));
    return {
      homeWidgetOrder,
      hiddenHomeWidgets,
      tabOrder: normaliseOrder(parsed.tabOrder, DEFAULT_TAB_ORDER),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES, homeWidgetOrder: [...HOME_WIDGET_IDS], hiddenHomeWidgets: [], tabOrder: [...DEFAULT_TAB_ORDER] };
  }
}

function moveItem<T>(items: readonly T[], item: T, targetIndex: number): T[] {
  const from = items.indexOf(item);
  if (from < 0 || items.length < 2) return [...items];
  const next = [...items];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, item);
  return next;
}

function storageKey(userId: string | null | undefined): string | null {
  return userId ? `wagesTracker.layout.v1:${userId}` : null;
}

function readPreferences(key: string | null): LayoutPreferences {
  if (!key || typeof window === "undefined") return parseLayoutPreferences(null);
  try {
    return parseLayoutPreferences(window.localStorage.getItem(key));
  } catch {
    return parseLayoutPreferences(null);
  }
}

export function LayoutPreferencesProvider({ userId, children }: { userId: string | null | undefined; children: ReactNode }) {
  const key = storageKey(userId);
  const [preferences, setPreferences] = useState<LayoutPreferences>(() => readPreferences(key));

  useEffect(() => setPreferences(readPreferences(key)), [key]);

  useEffect(() => {
    if (!key) return;
    const syncFromAnotherWindow = (event: StorageEvent) => {
      if (event.key === key) setPreferences(parseLayoutPreferences(event.newValue));
    };
    window.addEventListener("storage", syncFromAnotherWindow);
    return () => window.removeEventListener("storage", syncFromAnotherWindow);
  }, [key]);

  const update = useCallback((recipe: (current: LayoutPreferences) => LayoutPreferences) => {
    setPreferences((current) => {
      const next = recipe(current);
      if (key) {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // A full/private browser store should not make customisation unusable
          // for the rest of the current session.
        }
      }
      return next;
    });
  }, [key]);

  const moveHomeWidget = useCallback((id: HomeWidgetId, targetVisibleIndex: number) => {
    update((current) => {
      const hidden = new Set(current.hiddenHomeWidgets);
      const visible = current.homeWidgetOrder.filter((widgetId) => !hidden.has(widgetId));
      const reorderedVisible = moveItem(visible, id, targetVisibleIndex);
      const hiddenInOrder = current.homeWidgetOrder.filter((widgetId) => hidden.has(widgetId));
      return { ...current, homeWidgetOrder: [...reorderedVisible, ...hiddenInOrder] };
    });
  }, [update]);

  const setHomeWidgetVisible = useCallback((id: HomeWidgetId, visible: boolean) => {
    update((current) => {
      const hidden = new Set(current.hiddenHomeWidgets);
      if (visible) hidden.delete(id);
      else hidden.add(id);

      if (visible) {
        const visibleOrder = current.homeWidgetOrder.filter((widgetId) => !hidden.has(widgetId) && widgetId !== id);
        const hiddenOrder = current.homeWidgetOrder.filter((widgetId) => hidden.has(widgetId));
        return { ...current, hiddenHomeWidgets: [...hidden], homeWidgetOrder: [...visibleOrder, id, ...hiddenOrder] };
      }
      return { ...current, hiddenHomeWidgets: [...hidden] };
    });
  }, [update]);

  const moveTab = useCallback((id: Screen, targetIndex: number) => {
    update((current) => ({ ...current, tabOrder: moveItem(current.tabOrder, id, targetIndex) }));
  }, [update]);

  const resetHome = useCallback(() => {
    update((current) => ({ ...current, homeWidgetOrder: [...HOME_WIDGET_IDS], hiddenHomeWidgets: [] }));
  }, [update]);

  const resetTabs = useCallback(() => {
    update((current) => ({ ...current, tabOrder: [...DEFAULT_TAB_ORDER] }));
  }, [update]);

  const value = useMemo<LayoutPreferencesContextValue>(() => ({
    ...preferences,
    moveHomeWidget,
    setHomeWidgetVisible,
    moveTab,
    resetHome,
    resetTabs,
  }), [preferences, moveHomeWidget, setHomeWidgetVisible, moveTab, resetHome, resetTabs]);

  return <LayoutPreferencesContext.Provider value={value}>{children}</LayoutPreferencesContext.Provider>;
}

export function useLayoutPreferences(): LayoutPreferencesContextValue {
  return useContext(LayoutPreferencesContext);
}
