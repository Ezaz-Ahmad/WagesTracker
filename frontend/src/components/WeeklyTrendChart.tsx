import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { ChartPoint, WeekSummary } from "../lib/aggregate";
import { fmt2 } from "../lib/date";
import { useChartReveal } from "../lib/useChartReveal";

type Metric = "earnings" | "hours";

type WeeklyTrendChartProps = {
  chart: { points: ChartPoint[]; linePoints: string; areaPath: string };
  weeks: WeekSummary[];
  metric: Metric;
  currency: string;
  earningsHidden: boolean;
  goalHours: number;
  goalEarnings: number;
  ticking: boolean;
  summary: string;
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 124;
const PLOT_BASELINE = 118;

function metricValue(week: WeekSummary, metric: Metric): number {
  return metric === "earnings" ? week.earnings : week.hours;
}

function valueLabel(week: WeekSummary, metric: Metric, currency: string, earningsHidden: boolean): string {
  if (metric === "earnings") return earningsHidden ? "Earnings hidden" : `${currency}${fmt2(week.earnings)}`;
  return `${fmt2(week.hours)}h`;
}

function compactNumber(value: number): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 1_000_000) {
    const scaled = absolute / 1_000_000;
    const formatted = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, "") : `${Math.round(scaled)}`;
    return `${sign}${formatted}m`;
  }
  if (absolute >= 1_000) {
    const scaled = absolute / 1_000;
    const formatted = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, "") : `${Math.round(scaled)}`;
    return `${sign}${formatted}k`;
  }
  return `${Math.round(value)}`;
}

function visualValueLabels(
  week: WeekSummary,
  metric: Metric,
  currency: string,
  earningsHidden: boolean,
): { full: string; compact: string; private: boolean } {
  if (metric === "earnings") {
    if (earningsHidden) return { full: "***", compact: "***", private: true };
    const exact = `${currency}${fmt2(week.earnings)}`;
    const compact = `${currency}${compactNumber(week.earnings)}`;
    return {
      full: exact.length <= 10 ? exact : compact,
      compact,
      private: false,
    };
  }

  const compactHours = Math.round(week.hours * 10) / 10;
  return {
    full: `${fmt2(week.hours)}h`,
    compact: `${compactHours}h`,
    private: false,
  };
}

function comparisonLabel(current: number, previous: number | null, hidden: boolean) {
  if (hidden) return { label: "Change hidden", tone: "neutral" } as const;
  if (previous === null) return { label: "First week shown", tone: "neutral" } as const;
  if (previous === 0) {
    return current === 0
      ? ({ label: "No change", tone: "neutral" } as const)
      : ({ label: "Up from no activity", tone: "up" } as const);
  }
  const percentage = Math.round(((current - previous) / previous) * 100);
  if (percentage === 0) return { label: "No change", tone: "neutral" } as const;
  return {
    label: `${Math.abs(percentage)}% ${percentage > 0 ? "higher" : "lower"}`,
    tone: percentage > 0 ? "up" : "down",
  } as const;
}

function goalLabel(value: number, goal: number, hidden: boolean): string {
  if (hidden) return "Progress hidden";
  if (goal <= 0) return "No goal set";
  const percentage = Math.max(0, Math.round((value / goal) * 100));
  return value >= goal ? `Goal reached · ${percentage}%` : `${percentage}% of goal`;
}

/**
 * Responsive, interactive enhancement for Report's weekly trend.
 *
 * The SVG remains a named image and the exact-value table remains the source
 * of truth for assistive technology. A sibling HTML hit layer provides real
 * buttons for hover, touch and keyboard use without relying on fragile SVG
 * focus behaviour in older WebKit.
 */
export function WeeklyTrendChart({
  chart,
  weeks,
  metric,
  currency,
  earningsHidden,
  goalHours,
  goalEarnings,
  ticking,
  summary,
}: WeeklyTrendChartProps) {
  const reveal = useChartReveal<HTMLDivElement>();
  const layoutRef = useRef<HTMLDivElement>(null);
  const pointRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const instanceId = useId().replace(/:/g, "");
  const tooltipId = `${instanceId}-trend-detail`;
  const gradientId = `${instanceId}-trend-area`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const pointCount = Math.min(chart.points.length, weeks.length);
  const activeIndex = [hoveredIndex, focusedIndex, selectedIndex]
    .find((index) => index !== null && index >= 0 && index < pointCount) ?? null;
  const keyboardIndex = focusedIndex !== null && focusedIndex < pointCount
    ? focusedIndex
    : selectedIndex !== null && selectedIndex < pointCount
      ? selectedIndex
      : Math.max(0, pointCount - 1);

  useEffect(() => {
    setHoveredIndex(null);
    setFocusedIndex(null);
    setSelectedIndex(null);
  }, [metric]);

  useEffect(() => {
    if (selectedIndex === null) return;
    const dismissOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !layoutRef.current?.contains(event.target)) setSelectedIndex(null);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [selectedIndex]);

  const handlePointKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = Math.min(pointCount - 1, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = pointCount - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setHoveredIndex(null);
      setFocusedIndex(null);
      setSelectedIndex(null);
      return;
    } else return;

    event.preventDefault();
    pointRefs.current[nextIndex]?.focus();
  };

  const handlePointerEnter = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (event.pointerType !== "touch") setHoveredIndex(index);
  };

  const selectedWeek = activeIndex === null ? null : weeks[activeIndex];
  const selectedPoint = activeIndex === null ? null : chart.points[activeIndex];
  const selectedValue = selectedWeek ? metricValue(selectedWeek, metric) : 0;
  const previousValue = activeIndex !== null && activeIndex > 0 ? metricValue(weeks[activeIndex - 1], metric) : null;
  const hidesSelectedMetric = metric === "earnings" && earningsHidden;
  const comparison = comparisonLabel(selectedValue, previousValue, hidesSelectedMetric);
  const selectedGoal = metric === "earnings" ? goalEarnings : goalHours;
  const otherMetricLabel = metric === "earnings" ? "Hours worked" : "Earnings";
  const hidesOtherMetric = metric === "hours" && earningsHidden;
  const otherMetricValue = selectedWeek
    ? metric === "earnings"
      ? `${fmt2(selectedWeek.hours)}h`
      : `${currency}${fmt2(selectedWeek.earnings)}`
    : "—";

  return (
    <div className="report-trend-layout" ref={layoutRef}>
      <div ref={reveal.ref} className={`${reveal.revealClassName} report-trend-visual`}>
        <div className="report-trend-plot">
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="chart-svg" role="img" aria-label={summary}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-area-start)" />
                <stop offset="100%" stopColor="var(--color-chart-area-end)" />
              </linearGradient>
            </defs>
            {[30, 74, PLOT_BASELINE].map((y) => (
              <line
                key={y}
                x1="0"
                y1={y}
                x2={CHART_WIDTH}
                y2={y}
                className={y === PLOT_BASELINE ? "chart-grid-line is-strong" : "chart-grid-line"}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={chart.areaPath} fill={`url(#${gradientId})`} stroke="none" className="chart-area-fade" />
            {activeIndex !== null && selectedPoint && (
              <line
                x1={selectedPoint.x}
                y1="8"
                x2={selectedPoint.x}
                y2={PLOT_BASELINE}
                className="chart-point-guide"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <polyline
              points={chart.linePoints}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="chart-line-draw"
            />
            {chart.points.slice(0, pointCount).map((point, index) => (
              <g
                key={weeks[index].startISO}
                className={`chart-point${point.inProgress && ticking ? " is-live" : ""}${activeIndex === index ? " is-selected" : ""}`}
                style={{ ["--i" as string]: index }}
              >
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="4.5"
                  fill={point.dotColor}
                  stroke={point.dotStroke}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  className="chart-point-dot"
                  data-chart-point-dot={index}
                />
              </g>
            ))}
          </svg>

          <div className="report-trend-hit-layer" role="group" aria-label={`Weekly ${metric} trend`}>
            {chart.points.slice(0, pointCount).map((point, index) => {
              const week = weeks[index];
              const mainLabel = valueLabel(week, metric, currency, earningsHidden);
              const visualLabels = visualValueLabels(week, metric, currency, earningsHidden);
              const secondaryLabel = metric === "earnings"
                ? `${fmt2(week.hours)} hours worked`
                : earningsHidden
                  ? "earnings hidden"
                  : `${currency}${fmt2(week.earnings)} earnings`;
              return (
                <button
                  key={week.startISO}
                  ref={(element) => { pointRefs.current[index] = element; }}
                  type="button"
                  className="report-chart-point-button"
                  data-chart-point={index}
                  style={{
                    ["--chart-point-x" as string]: `${(point.x / CHART_WIDTH) * 100}%`,
                    ["--chart-point-y" as string]: `${(point.y / CHART_HEIGHT) * 100}%`,
                    ["--i" as string]: index,
                  } as CSSProperties}
                  tabIndex={index === keyboardIndex ? 0 : -1}
                  aria-label={`${week.label}${week.inProgress ? ", in progress" : ""}: ${mainLabel}; ${secondaryLabel}`}
                  aria-pressed={selectedIndex === index}
                  aria-describedby={activeIndex === index ? tooltipId : undefined}
                  onPointerEnter={(event) => handlePointerEnter(event, index)}
                  onPointerLeave={(event) => { if (event.pointerType !== "touch") setHoveredIndex(null); }}
                  onFocus={() => setFocusedIndex(index)}
                  onBlur={() => setFocusedIndex((current) => current === index ? null : current)}
                  onClick={(event) => {
                    setHoveredIndex(null);
                    setSelectedIndex((current) => current === index ? null : index);
                    if (event.detail > 0) {
                      setFocusedIndex(null);
                      event.currentTarget.blur();
                    }
                  }}
                  onKeyDown={(event) => handlePointKeyDown(event, index)}
                >
                  <span
                    className={`report-chart-value-label${activeIndex === index ? " is-selected" : ""}${visualLabels.private ? " is-private" : ""}`}
                    data-chart-value={index}
                    data-value-privacy={visualLabels.private ? "hidden" : "visible"}
                    aria-hidden="true"
                  >
                    <span
                      className="report-chart-value-content"
                      key={`${metric}:${visualLabels.private ? "private" : "visible"}`}
                    >
                      <span className="report-chart-value-full">{visualLabels.full}</span>
                      <span className="report-chart-value-compact">{visualLabels.compact}</span>
                    </span>
                  </span>
                  <span className="visually-hidden">Inspect {week.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="chart-x-labels" aria-hidden="true">
          {chart.points.slice(0, pointCount).map((point, index) => (
            <div className="chart-x-label" key={weeks[index].startISO} style={{ ["--i" as string]: index }}>
              {point.short}
            </div>
          ))}
        </div>
      </div>

      <div
        id={tooltipId}
        className={`report-trend-inspector${selectedWeek ? " is-active" : " is-idle"}`}
        role={selectedWeek ? "tooltip" : undefined}
      >
        {selectedWeek && selectedPoint ? (
          <div className="report-trend-inspector-content" key={`${metric}:${selectedWeek.startISO}`}>
            <div className="report-trend-inspector-head">
              <span className="card-kicker">Selected week</span>
              <span className={`report-trend-status${selectedWeek.inProgress ? " is-live" : ""}`}>
                {selectedWeek.inProgress ? "In progress" : "Completed"}
              </span>
            </div>
            <strong className="report-trend-inspector-title">{selectedWeek.label}</strong>
            <strong className={`report-trend-inspector-value${hidesSelectedMetric ? " is-hidden" : ""}`}>
              {hidesSelectedMetric ? (
                <><span aria-hidden="true">***</span><span className="visually-hidden">Earnings hidden</span></>
              ) : valueLabel(selectedWeek, metric, currency, earningsHidden)}
            </strong>
            <span className="report-trend-inspector-metric">Weekly {metric}</span>
            <dl>
              <div>
                <dt>{otherMetricLabel}</dt>
                <dd>{hidesOtherMetric ? (
                  <><span aria-hidden="true">***</span><span className="visually-hidden">Earnings hidden</span></>
                ) : otherMetricValue}</dd>
              </div>
              <div><dt>Vs prior week</dt><dd className={`is-${comparison.tone}`}>{comparison.label}</dd></div>
              <div><dt>Weekly target</dt><dd>{goalLabel(selectedValue, selectedGoal, hidesSelectedMetric)}</dd></div>
            </dl>
            <p>Hover, focus or tap another point to compare.</p>
          </div>
        ) : (
          <div className="report-trend-inspector-empty">
            <span className="report-trend-inspector-icon" aria-hidden="true" />
            <strong>Explore your trend</strong>
            <span>Hover, tap or use the keyboard to inspect any week.</span>
          </div>
        )}
      </div>
    </div>
  );
}
