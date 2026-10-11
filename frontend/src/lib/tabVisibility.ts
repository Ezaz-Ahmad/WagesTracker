import type { HomeWidgetId } from "../context/LayoutPreferencesContext";
import type { Screen } from "./types";

export type HideableTab = Exclude<Screen, "settings">;

export const TAB_DESCRIPTIONS: Record<Screen, string> = {
  home: "Weekly overview & goals",
  entry: "Shifts, fuel & extra earnings",
  spending: "Personal expenses & insights",
  report: "Weekly reports & wage PDFs",
  history: "Past weeks & saved shift edits",
  settings: "Preferences & your account",
};

export const TAB_HIDE_DETAILS: Record<HideableTab, { features: string; impact: string }> = {
  home: {
    features: "Your weekly overview, goal progress and Home shortcuts will be hidden.",
    impact: "Your saved shifts and earnings keep calculating as usual.",
  },
  entry: {
    features: "Manual shift entries, fuel adjustments and extra earnings will leave your menu.",
    impact: "Saved hours, fuel allowances and extra earnings still count toward your wages.",
  },
  spending: {
    features: "Expense entry, categories and spending insights, including the Home snapshot, will be hidden.",
    impact: "Personal spending is separate from your wages. Your expenses stay saved.",
  },
  report: {
    features: "Current-week summaries and wage PDF downloads will leave your menu.",
    impact: "Your hours and wages still calculate normally. Saved records stay available.",
  },
  history: {
    features: "Past weeks, saved shift edits and historical PDF downloads will leave your menu.",
    impact: "Your past records remain saved and still count toward your earnings.",
  },
};

export function shiftAccessWarning(tab: HideableTab, hiddenTabs: readonly Screen[], hiddenHomeWidgets: readonly HomeWidgetId[]): string | null {
  if (tab !== "home" && tab !== "entry") return null;
  const nextHidden = new Set([...hiddenTabs, tab]);
  const homeClockAvailable = !nextHidden.has("home") && !hiddenHomeWidgets.includes("today-shift");
  if (!nextHidden.has("entry") || homeClockAvailable) return null;
  return nextHidden.has("home")
    ? "To clock in or out in the app, restore Home or Entry. Any active shift keeps running."
    : "To clock in or out in the app, restore Entry or show Today's shift on Home. Any active shift keeps running.";
}
