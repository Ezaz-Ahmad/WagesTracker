// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_NAVIGATION_EVENT, navigateWithinApp, returnToWageTracker } from "../appNavigation";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("in-app public navigation", () => {
  it("uses history navigation and marks a public page as internally opened", () => {
    const listener = vi.fn();
    window.addEventListener(APP_NAVIGATION_EVENT, listener, { once: true });
    navigateWithinApp("/privacy");
    expect(window.location.pathname).toBe("/privacy");
    expect(window.history.state.wageTrackerInternalPage).toBe(true);
    expect(window.history.state.wageTrackerReturnDepth).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns through the complete public-page history when the page came from the app", () => {
    window.history.replaceState({ wageTrackerInternalPage: true, wageTrackerReturnDepth: 2 }, "", "/support");
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    returnToWageTracker();
    expect(go).toHaveBeenCalledWith(-2);
  });

  it("increases return depth when navigating between public pages", () => {
    window.history.replaceState({ wageTrackerInternalPage: true, wageTrackerReturnDepth: 1 }, "", "/privacy");
    navigateWithinApp("/support");
    expect(window.history.state.wageTrackerReturnDepth).toBe(2);
  });

  it("returns a directly opened public page to the app without adding another entry", () => {
    window.history.replaceState(null, "", "/privacy");
    returnToWageTracker();
    expect(window.location.pathname).toBe("/");
  });
});
