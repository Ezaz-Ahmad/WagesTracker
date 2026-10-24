// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import { AdminEarningsChart, type AdminEarningsDay } from "../AdminEarningsChart";

const days: AdminEarningsDay[] = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-10-${19 + index}`,
  hours: index === 1 ? 7.5 : 0,
  wages: index === 1 ? 225 : 0,
  fuel: index === 1 ? 15 : 0,
  total: index === 1 ? 240 : 0,
  shiftCount: index === 1 ? 1 : 0,
  openShiftCount: index === 1 ? 1 : 0,
}));
const previousDays = days.map((day, index) => ({ ...day, date: `2026-10-${12 + index}`, total: index === 1 ? 180 : 0 }));

afterEach(cleanup);

describe("AdminEarningsChart", () => {
  it("exposes the exact wages, fuel, hours and prior-week comparison for the selected day", async () => {
    const user = userEvent.setup();
    render(<AdminEarningsChart days={days} previousDays={previousDays} />);

    const selected = screen.getByRole("button", { name: /Tuesday 20 Oct: \$240\.00 total/i });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.getAttribute("aria-label")).toContain("$225.00 wages, $15.00 fuel, 7.5 hours");
    expect(selected.getAttribute("aria-label")).toContain("Previous week: $180.00");
    const detail = screen.getByRole("status");
    expect(within(detail).getByText("$240.00")).toBeTruthy();
    expect(within(detail).getByText("1 open shift · Earnings are still in progress.")).toBeTruthy();

    await user.click(screen.getByText("View daily figures"));
    const table = screen.getByRole("table", { name: "Daily earnings: exact daily shift figures" });
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByText("$180.00")).toBeTruthy();
  });

  it("supports one keyboard entry point, arrow keys, Home and End without a pointer", async () => {
    const user = userEvent.setup();
    render(<AdminEarningsChart days={days} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);

    await user.tab();
    expect(document.activeElement).toBe(buttons[1]);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(buttons[2]);
    expect(within(screen.getByRole("status")).getByText("Wednesday 21 Oct")).toBeTruthy();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(buttons[6]);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(buttons[0]);
    await user.keyboard("{End}{Home}");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("keeps tap selection and resets to a valid day when the displayed week changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AdminEarningsChart days={days} />);
    await user.click(screen.getByRole("button", { name: /Friday 23 Oct/i }));
    expect(within(screen.getByRole("status")).getByText("Friday 23 Oct")).toBeTruthy();

    rerender(<AdminEarningsChart days={previousDays} />);
    expect(within(screen.getByRole("status")).getByText("Tuesday 13 Oct")).toBeTruthy();
    expect(screen.getByRole("button", { pressed: true }).getAttribute("aria-label")).toContain("Tuesday 13 Oct");
  });

  it("previews a hovered day and restores the persisted day when the pointer leaves the chart", async () => {
    const user = userEvent.setup();
    render(<AdminEarningsChart days={days} />);
    const friday = screen.getByRole("button", { name: /Friday 23 Oct/i });
    await user.hover(friday);
    expect(within(screen.getByRole("status")).getByText("Friday 23 Oct")).toBeTruthy();
    expect(screen.getByRole("button", { pressed: true }).getAttribute("aria-label")).toContain("Tuesday 20 Oct");
    await user.unhover(friday);
    expect(within(screen.getByRole("status")).getByText("Tuesday 20 Oct")).toBeTruthy();
  });

  it("announces empty and zero weeks without inventing a value", () => {
    const { rerender } = render(<AdminEarningsChart days={[]} />);
    expect(screen.getByText("No daily earnings to display for this week.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    rerender(<AdminEarningsChart days={days.map((day) => ({ ...day, wages: 0, fuel: 0, total: 0 }))} />);
    expect(screen.getByText("No shift earnings recorded this week yet.")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(7);
    expect(within(screen.getByRole("status")).getAllByText("$0.00")).toHaveLength(3);
  });

  it("gives compact directory charts a useful accessible name and no nested controls", () => {
    render(<AdminEarningsChart days={days} label="Alex's daily earnings" compact />);
    expect(screen.getByRole("img", { name: "Alex's daily earnings: $240.00 in daily shift earnings." })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("View daily figures")).toBeNull();
  });

  it("has no detectable accessibility violations with an expanded data table", async () => {
    const user = userEvent.setup();
    const { container } = render(<AdminEarningsChart days={days} previousDays={previousDays} />);
    await user.click(screen.getByText("View daily figures"));
    const result = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
