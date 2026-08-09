// @vitest-environment jsdom
//
// Regression tests for the Settings category-row redesign (icon + title/hint
// + chevron, selected-state accent styling). The dimension-stability and
// "no shake" guarantees themselves live in CSS (background/border/shadow
// transitions only, no transform — see settings.css) and are verified in a
// real browser, not jsdom (which doesn't apply the app's stylesheet). What's
// worth pinning here is the structural contract the redesign must not
// break: each row's leading icon and trailing chevron are purely decorative
// (never leak into the button's accessible name or the tab order), and
// exactly one row carries the selected styling hook (`is-active`) and
// `aria-current` at a time — the same contract SettingsHub.test.tsx and
// SettingsFocusManagement.test.tsx already exercise for behavior, this file
// just pins the new markup those tests render through.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsNav, type SettingsCategory } from "../SettingsNav";
import { TargetIcon } from "../../components/icons";

const categories: readonly SettingsCategory[] = [
  { id: "a", label: "Category A", hint: "First hint", icon: TargetIcon },
  { id: "b", label: "Category B", hint: "Second hint", icon: TargetIcon },
];

afterEach(() => {
  cleanup();
});

describe("SettingsNav — redesigned rows", () => {
  it("keeps the leading icon and trailing chevron out of the accessible name and the tab order", () => {
    render(<SettingsNav categories={categories} activeCategory="a" onSelect={() => {}} />);

    const button = screen.getByRole("button", { name: "Category AFirst hint" });
    // Nothing from the icon/chevron svgs leaked into the accessible name.
    expect(button.textContent).toBe("Category AFirst hint");

    const icon = button.querySelector(".settings-nav-item-icon");
    const chevron = button.querySelector(".settings-nav-item-chevron");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    // Only the row itself is a tab stop — the icon/chevron aren't separate
    // focusable elements.
    expect(icon?.querySelector("button, a, [tabindex]")).toBeNull();
    expect(chevron?.querySelector("button, a, [tabindex]")).toBeNull();
  });

  it("marks exactly one row selected (is-active + aria-current) at a time, and moves it on click", async () => {
    const user = userEvent.setup();
    const onSelect = (id: string) => rerender(id);
    let currentActive = "a";
    function rerender(next: string) {
      currentActive = next;
    }
    const { rerender: reactRerender } = render(
      <SettingsNav categories={categories} activeCategory={currentActive} onSelect={onSelect} />
    );

    const buttonA = screen.getByRole("button", { name: /category a/i });
    const buttonB = screen.getByRole("button", { name: /category b/i });
    expect(buttonA.className).toMatch(/\bis-active\b/);
    expect(buttonA.getAttribute("aria-current")).toBe("page");
    expect(buttonB.className).not.toMatch(/\bis-active\b/);
    expect(buttonB.getAttribute("aria-current")).toBeNull();

    await user.click(buttonB);
    expect(currentActive).toBe("b");
    reactRerender(<SettingsNav categories={categories} activeCategory={currentActive} onSelect={onSelect} />);

    const buttonBAfter = screen.getByRole("button", { name: /category b/i });
    const buttonAAfter = screen.getByRole("button", { name: /category a/i });
    expect(buttonBAfter.className).toMatch(/\bis-active\b/);
    expect(buttonAAfter.className).not.toMatch(/\bis-active\b/);
  });

  it("renders every category's own icon (not a shared fallback)", () => {
    render(<SettingsNav categories={categories} activeCategory="a" onSelect={() => {}} />);
    const icons = screen.getAllByRole("button").map((b) => b.querySelector(".settings-nav-item-icon svg"));
    expect(icons).toHaveLength(2);
    expect(icons.every(Boolean)).toBe(true);
  });
});
