// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutPreferencesProvider, parseLayoutPreferences, useLayoutPreferences } from "../../context/LayoutPreferencesContext";
import { BottomNav, tabsInOrder } from "../BottomNav";
import { LayoutCustomizer } from "../LayoutCustomizer";

expect.extend(toHaveNoViolations);

function NavigationPreview() {
  const { visibleTabOrder } = useLayoutPreferences();
  return <BottomNav screen="home" onNavigate={vi.fn()} tabs={tabsInOrder(visibleTabOrder)} />;
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
      hiddenTabs: ["settings", "spending", "spending", "retired-tab"],
    }));

    expect(parsed.homeWidgetOrder[0]).toBe("best-day");
    expect(parsed.homeWidgetOrder).toHaveLength(8);
    expect(parsed.hiddenHomeWidgets).toEqual(["spending"]);
    expect(parsed.tabOrder.slice(0, 2)).toEqual(["settings", "home"]);
    expect(parsed.tabOrder).toHaveLength(6);
    expect(parsed.hiddenTabs).toEqual(["spending"]);
    expect(parseLayoutPreferences(JSON.stringify({ tabOrder: ["entry"] })).hiddenTabs).toEqual([]);
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
    await user.click(screen.getByRole("button", { name: "Hide Spending" }));
    expect(await axe(screen.getByRole("alertdialog", { name: "Hide Spending?" }), options)).toHaveNoViolations();
  });

  it("requires confirmation, keeps cancellation reversible, and restores hidden tabs after a reload", async () => {
    const user = userEvent.setup();
    const renderLayout = () => render(<LayoutPreferencesProvider userId="confirm-user"><NavigationPreview /><LayoutCustomizer onClose={vi.fn()} /></LayoutPreferencesProvider>);
    renderLayout();
    await user.click(screen.getByRole("tab", { name: "Tab bar" }));
    const hide = screen.getByRole("button", { name: "Hide Spending" });
    await user.click(hide);
    let confirmation = screen.getByRole("alertdialog", { name: "Hide Spending?" });
    expect(confirmation.textContent).toContain("Personal spending is separate from your wages");
    expect(parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:confirm-user")).hiddenTabs).toEqual([]);
    expect(document.activeElement).toBe(within(confirmation).getByRole("button", { name: "Keep tab" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(hide);
    expect(screen.getByRole("dialog", { name: "Customise your layout" })).toBeTruthy();
    await user.click(hide);
    confirmation = screen.getByRole("alertdialog", { name: "Hide Spending?" });
    await user.click(within(confirmation).getByRole("button", { name: "Hide Spending" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("button", { name: "Spending" })).toBeNull();
    expect(parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:confirm-user")).hiddenTabs).toEqual(["spending"]);
    cleanup();
    renderLayout();
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("button", { name: "Spending" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Tab bar" }));
    await user.click(screen.getByRole("button", { name: "Show Spending tab" }));
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Spending" })).toBeTruthy();
    expect(parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:confirm-user")).hiddenTabs).toEqual([]);
  });

  it("reorders visible tabs around hidden positions and Reset restores the menu without resetting Home", async () => {
    localStorage.setItem("wagesTracker.layout.v1:reset-user", JSON.stringify({ hiddenTabs: ["spending"], hiddenHomeWidgets: ["best-day"] }));
    const user = userEvent.setup();
    render(<LayoutPreferencesProvider userId="reset-user"><NavigationPreview /><LayoutCustomizer onClose={vi.fn()} /></LayoutPreferencesProvider>);
    await user.click(screen.getByRole("tab", { name: "Tab bar" }));
    expect(screen.queryByRole("button", { name: "Hide Settings" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Move Report up" }));
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["Home", "Report", "Entry", "History", "Settings"]);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["Home", "Entry", "Spending", "Report", "History", "Settings"]);
    const saved = parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:reset-user"));
    expect(saved.hiddenTabs).toEqual([]);
    expect(saved.hiddenHomeWidgets).toEqual(["best-day"]);
  });

  it("does not carry one account's hidden tabs into another account", async () => {
    localStorage.setItem("wagesTracker.layout.v1:first", JSON.stringify({ hiddenTabs: ["spending"] }));
    const content = <><NavigationPreview /><LayoutCustomizer onClose={vi.fn()} /></>;
    const { rerender } = render(<LayoutPreferencesProvider userId="first">{content}</LayoutPreferencesProvider>);
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("button", { name: "Spending" })).toBeNull();
    rerender(<LayoutPreferencesProvider userId="second">{content}</LayoutPreferencesProvider>);
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Spending" })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Tab bar" }));
    await user.click(screen.getByRole("button", { name: "Move Entry up" }));
    expect(parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:first")).hiddenTabs).toEqual(["spending"]);
    expect(parseLayoutPreferences(localStorage.getItem("wagesTracker.layout.v1:second")).hiddenTabs).toEqual([]);
  });
});
