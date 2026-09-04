// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutPreferencesProvider, parseLayoutPreferences, useLayoutPreferences } from "../../context/LayoutPreferencesContext";
import { BottomNav, tabsInOrder } from "../BottomNav";
import { LayoutCustomizer } from "../LayoutCustomizer";

expect.extend(toHaveNoViolations);

function NavigationPreview() {
  const { tabOrder } = useLayoutPreferences();
  return <BottomNav screen="home" onNavigate={vi.fn()} tabs={tabsInOrder(tabOrder)} />;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("layout customisation", () => {
  it("reorders and hides widgets, supports adding them back, and persists each change", async () => {
    const user = userEvent.setup();
    render(
      <LayoutPreferencesProvider userId="layout-user">
        <LayoutCustomizer onClose={vi.fn()} />
      </LayoutPreferencesProvider>
    );

    await user.click(screen.getByRole("button", { name: "Move Personal spending up" }));
    await user.click(screen.getByRole("button", { name: "Move Personal spending up" }));
    await user.click(screen.getByRole("button", { name: "Hide Week summary" }));

    let saved = parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:layout-user"));
    expect(saved.homeWidgetOrder[0]).toBe("spending");
    expect(saved.hiddenHomeWidgets).toContain("week-summary");
    expect(screen.queryByRole("button", { name: "Hide Week summary" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add Week summary to dashboard" }));
    saved = parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:layout-user"));
    expect(saved.hiddenHomeWidgets).not.toContain("week-summary");
    expect(saved.homeWidgetOrder.at(-1)).toBe("week-summary");
  });

  it("keeps the visible navigation and swipe order aligned with the saved tab order", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LayoutPreferencesProvider userId="nav-user">
        <NavigationPreview />
        <LayoutCustomizer onClose={vi.fn()} />
      </LayoutPreferencesProvider>
    );

    await user.click(screen.getByRole("tab", { name: "Tab bar" }));
    await user.click(screen.getByRole("button", { name: "Move Entry up" }));

    const nav = container.querySelector("nav")!;
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Entry", "Home", "Spending", "Report", "History", "Settings",
    ]);
    expect(parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:nav-user")).tabOrder.slice(0, 2)).toEqual(["entry", "home"]);
  });

  it("repairs stale or malformed saved layouts without losing valid choices", () => {
    const parsed = parseLayoutPreferences(JSON.stringify({
      homeWidgetOrder: ["best-day", "best-day", "retired-widget"],
      hiddenHomeWidgets: ["spending", "retired-widget"],
      tabOrder: ["settings", "home", "settings", "retired-tab"],
    }));

    expect(parsed.homeWidgetOrder[0]).toBe("best-day");
    expect(parsed.homeWidgetOrder).toHaveLength(8);
    expect(parsed.hiddenHomeWidgets).toEqual(["spending"]);
    expect(parsed.tabOrder.slice(0, 2)).toEqual(["settings", "home"]);
    expect(parsed.tabOrder).toHaveLength(6);
  });

  it("has no detectable accessibility violations in both customisation panels", async () => {
    const user = userEvent.setup();
    render(
      <LayoutPreferencesProvider userId="a11y-user">
        <LayoutCustomizer onClose={vi.fn()} />
      </LayoutPreferencesProvider>
    );

    const dialog = screen.getByRole("dialog", { name: "Customise your layout" });
    const options = { rules: { "color-contrast": { enabled: false } } };
    expect(await axe(dialog, options)).toHaveNoViolations();
    await user.click(screen.getByRole("tab", { name: "Tab bar" }));
    expect(await axe(dialog, options)).toHaveNoViolations();
  });
});
