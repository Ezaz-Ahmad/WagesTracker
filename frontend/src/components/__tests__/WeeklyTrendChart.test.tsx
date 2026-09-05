// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import { buildChart, type WeekSummary } from "../../lib/aggregate";
import { WeeklyTrendChart } from "../WeeklyTrendChart";

const CURRENCY = "$";
expect.extend(toHaveNoViolations);
const WEEKS: WeekSummary[] = [
  {
    startISO: "2026-07-27",
    endISO: "2026-08-02",
    label: "Jul 27 – Aug 2",
    short: "Jul 27",
    hours: 80,
    earnings: 2050.49,
  },
  {
    startISO: "2026-08-03",
    endISO: "2026-08-09",
    label: "Aug 3 – Aug 9",
    short: "Aug 3",
    hours: 34.5,
    earnings: 862.5,
  },
  {
    startISO: "current",
    endISO: "current",
    label: "This week",
    short: "Now",
    hours: 2.58,
    earnings: 90.42,
    inProgress: true,
  },
];

type Metric = "earnings" | "hours";

function renderChart(options: { metric?: Metric; earningsHidden?: boolean } = {}) {
  const metric = options.metric ?? "earnings";
  const earningsHidden = options.earningsHidden ?? false;
  return render(
    <WeeklyTrendChart
      chart={buildChart(WEEKS, metric, CURRENCY)}
      weeks={WEEKS}
      metric={metric}
      currency={CURRENCY}
      earningsHidden={earningsHidden}
      goalHours={38}
      goalEarnings={950}
      ticking
      summary={`Line chart of weekly ${metric}. Exact figures follow in the table.`}
    />
  );
}

function pointControls(metric: Metric = "earnings") {
  const group = screen.getByRole("group", { name: `Weekly ${metric} trend` });
  return within(group).getAllByRole("button");
}

afterEach(cleanup);

describe("WeeklyTrendChart", () => {
  it("publishes named point controls with one roving tab stop", () => {
    renderChart();

    const points = pointControls();
    expect(points).toHaveLength(WEEKS.length);
    expect(points[0].getAttribute("aria-label")).toBe("Jul 27 – Aug 2: $2050.49; 80.00 hours worked");
    expect(points[2].getAttribute("aria-label")).toBe("This week, in progress: $90.42; 2.58 hours worked");
    expect(points.map((point) => point.tabIndex)).toEqual([-1, -1, 0]);
    expect(points.every((point) => point.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/weekly earnings/i);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows and describes details on mouse hover and keyboard focus", () => {
    renderChart();
    const points = pointControls();

    fireEvent.pointerEnter(points[0], { pointerType: "mouse" });
    let tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Jul 27 – Aug 2");
    expect(tooltip.textContent).toContain("$2050.49");
    expect(tooltip.textContent).toContain("Completed");
    expect(points[0].getAttribute("aria-describedby")).toBe(tooltip.id);

    fireEvent.pointerLeave(points[0], { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(points[0].hasAttribute("aria-describedby")).toBe(false);

    fireEvent.focus(points[1]);
    tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Aug 3 – Aug 9");
    expect(points[1].getAttribute("aria-describedby")).toBe(tooltip.id);

    fireEvent.blur(points[1]);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("pins a point on click, toggles it off, and dismisses a pin outside", () => {
    renderChart();
    const points = pointControls();

    fireEvent.click(points[0], { detail: 1 });
    expect(screen.getByRole("tooltip").textContent).toContain("Jul 27 – Aug 2");
    expect(points[0].getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(points[0], { detail: 1 });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(points[0].getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(points[1], { detail: 1 });
    expect(screen.getByRole("tooltip").textContent).toContain("Aug 3 – Aug 9");
    fireEvent.pointerDown(document.body, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(points[1].getAttribute("aria-pressed")).toBe("false");
  });

  it("moves the roving focus with arrows, Home and End, and dismisses with Escape", () => {
    renderChart();
    const points = pointControls();

    points[2].focus();
    fireEvent.keyDown(points[2], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(points[1]);
    expect(points.map((point) => point.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByRole("tooltip").textContent).toContain("Aug 3 – Aug 9");

    fireEvent.keyDown(points[1], { key: "Home" });
    expect(document.activeElement).toBe(points[0]);
    expect(points.map((point) => point.tabIndex)).toEqual([0, -1, -1]);

    fireEvent.keyDown(points[0], { key: "End" });
    expect(document.activeElement).toBe(points[2]);
    expect(points.map((point) => point.tabIndex)).toEqual([-1, -1, 0]);

    fireEvent.keyDown(points[2], { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(points[2]);
    expect(points[2].hasAttribute("aria-describedby")).toBe(false);
  });

  it("never exposes earnings through point names or details while privacy mode is active", () => {
    const { container } = renderChart({ earningsHidden: true });
    const points = pointControls();

    expect(points.map((point) => point.getAttribute("aria-label")).join(" ")).not.toMatch(/\$\d/);
    expect(points[0].getAttribute("aria-label")).toContain("Earnings hidden");

    fireEvent.focus(points[0]);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Earnings hidden");
    expect(tooltip.textContent).toContain("Change hidden");
    expect(tooltip.textContent).toContain("Progress hidden");
    expect(tooltip.textContent).not.toMatch(/\$\d/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it("clears selection and recalculates accessible details when the metric changes", () => {
    const view = renderChart();
    fireEvent.click(pointControls()[0], { detail: 1 });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    view.rerender(
      <WeeklyTrendChart
        chart={buildChart(WEEKS, "hours", CURRENCY)}
        weeks={WEEKS}
        metric="hours"
        currency={CURRENCY}
        earningsHidden={false}
        goalHours={38}
        goalEarnings={950}
        ticking
        summary="Line chart of weekly hours. Exact figures follow in the table."
      />
    );

    expect(screen.queryByRole("tooltip")).toBeNull();
    const points = pointControls("hours");
    expect(points[0].getAttribute("aria-label")).toBe("Jul 27 – Aug 2: 80.00h; $2050.49 earnings");
    expect(points.every((point) => point.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(points.map((point) => point.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("does not remount the SVG or trend line for tooltip interactions", () => {
    const { container } = renderChart();
    const points = pointControls();
    const svg = container.querySelector(".chart-svg");
    const line = container.querySelector(".chart-line-draw");

    fireEvent.pointerEnter(points[0], { pointerType: "mouse" });
    fireEvent.pointerLeave(points[0], { pointerType: "mouse" });
    fireEvent.click(points[1], { detail: 1 });
    fireEvent.pointerDown(document.body, { pointerType: "mouse" });

    expect(container.querySelector(".chart-svg")).toBe(svg);
    expect(container.querySelector(".chart-line-draw")).toBe(line);
  });

  it("keeps the interactive detail state free of automated accessibility violations", async () => {
    const { container } = renderChart();
    fireEvent.focus(pointControls()[1]);

    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });
});
