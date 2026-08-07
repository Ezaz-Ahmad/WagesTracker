import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import {
  buildBars,
  buildChart,
  buildChartSource,
  buildMonthlyItems,
  buildWeekDaysComputed,
  buildWeeklyHistory,
  buildYearlyItems,
  groupByDate,
  groupExpensesByDate,
  weekExtraFor,
  weekTotals,
} from "../lib/aggregate";
import { buildWeekDays, fmt2, isoDate } from "../lib/date";
import { buildWeekReportData } from "../lib/reportData";
import { generateReportPdf } from "../pdf/generateReportPdf";
import { useCountUp } from "../lib/useCountUp";
import { Skeleton } from "../components/Skeleton";
import { GoalRing } from "../components/GoalRing";
import { Amount } from "../components/Amount";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";

type Metric = "earnings" | "hours";
type Period = "week" | "month" | "year";

export function ReportScreen() {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras, earningsHidden } = useApp();
  const [metric, setMetric] = useState<Metric>("earnings");
  const [period, setPeriod] = useState<Period>("week");

  // Hooks below must run every render regardless of loading state, so the
  // bail-out has to come after all of them — see HomeScreen for the same fix.
  const rate = user?.rate ?? 0;
  const weekStartsOn = user?.weekStartsOn ?? "Monday";
  const goalHours = user?.goalHours ?? 0;
  const goalEarnings = user?.goalEarnings ?? 0;
  const createdAt = user?.createdAt ?? today.toISOString();

  const weekDays = buildWeekDays(today, weekStartsOn);
  const weekStartISO = isoDate(weekDays[0]);
  const shiftsByDate = groupByDate(shifts);
  const expensesByDate = groupExpensesByDate(dayExpenses);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, CURRENCY, rate, expensesByDate);
  const { hours: totalHours, earnings: weekEarnings } = weekTotals(days, rate);
  const totalEarnings = weekEarnings + (weekExtraFor(weekStartISO, weekExtras)?.amount ?? 0);

  const history = buildWeeklyHistory(shifts, today, weekStartsOn, rate, 7, new Date(createdAt), dayExpenses, weekExtras);
  const chartSource = buildChartSource(history, totalHours, totalEarnings);
  const chart = buildChart(chartSource, metric, CURRENCY);

  const progressPct = goalHours > 0 ? Math.min(100, Math.round((totalHours / goalHours) * 100)) : 0;
  const earningsProgressPct = goalEarnings > 0 ? Math.min(100, Math.round((totalEarnings / goalEarnings) * 100)) : 0;
  const metGoalCount = history.filter((w) => w.earnings >= goalEarnings).length;
  const metGoalAnim = Math.round(useCountUp(metGoalCount, 450));
  const progressPctAnim = Math.round(useCountUp(progressPct, 550));
  const earningsProgressPctAnim = Math.round(useCountUp(earningsProgressPct, 550));

  const periodItems =
    period === "month"
      ? buildMonthlyItems(shifts, today, rate, 6, dayExpenses, weekExtras)
      : period === "year"
        ? buildYearlyItems(shifts, today, rate, 2, dayExpenses, weekExtras)
        : chartSource;
  const periodBars = buildBars(periodItems, metric, CURRENCY);

  if (!user) return null;
  if (!shiftsLoaded) {
    return (
      <div className="screen-wide screen-transition">
        <h6 className="section-title">Progress report</h6>
        <Skeleton className="skeleton-card" style={{ height: 76 }} />
        <Skeleton className="skeleton-chart" />
        <Skeleton className="skeleton-bars" />
      </div>
    );
  }

  function handleDownloadPdf() {
    void generateReportPdf(buildWeekReportData(user!, shifts, today, CURRENCY, dayExpenses, weekExtras));
  }

  const metricLabel = metric === "earnings" ? "earnings" : "hours";

  return (
    <div className="screen-wide">
      <div className="row-baseline">
        <h6 className="section-title">Progress report</h6>
        <button className="btn btn-ghost" onClick={handleDownloadPdf} style={{ flex: "none" }}>
          Download this week (PDF)
        </button>
      </div>
      <div className="section-hint">Last 7 weeks plus this week in progress.</div>

      {/* Headline numbers up front, before any chart — answers "how am I
          doing this week" in one glance instead of making that the reward
          for reading a chart first. */}
      <div className="card elev-sm anim-rise report-hero-card" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 0 }}>
        <div className="report-hero-row">
          <div>
            <div className="card-kicker">This week's earnings</div>
            <div className="week-amount count-value">
              <Amount>{CURRENCY}{fmt2(totalEarnings)}</Amount>
            </div>
          </div>
          <div className="report-hero-divider" aria-hidden="true" />
          <div>
            <div className="card-kicker">This week's hours</div>
            <div className="week-amount count-value report-hero-hours">{fmt2(totalHours)}h</div>
          </div>
        </div>
        <EarningsHiddenHint />
      </div>

      <div className="card elev-sm anim-rise" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 1 }}>
        <div className="row-baseline">
          <div className="card-kicker">Weekly trend</div>
          <div className="seg">
            <label className="seg-opt">
              <input type="radio" name="metric" checked={metric === "earnings"} onChange={() => setMetric("earnings")} /> Earnings
            </label>
            <label className="seg-opt">
              <input type="radio" name="metric" checked={metric === "hours"} onChange={() => setMetric("hours")} /> Hours
            </label>
          </div>
        </div>

        {/* `width="100%"` with no fixed `height` and no `preserveAspectRatio`
            override lets the default uniform ("meet") scaling do the work —
            paired with the CSS `aspect-ratio` on .chart-svg matching this
            viewBox exactly, the chart scales the same in x and y at every
            container width. It used to force height to a flat 150px (190px
            on tablet, 220px on desktop) while width flexed independently,
            which stretched the dots into ellipses and the line out of
            proportion on anything other than a ~320px-wide phone. */}
        <svg viewBox="0 0 320 150" width="100%" className="chart-svg">
          <defs>
            <linearGradient id="reportAreaFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent-300)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--color-accent-100)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[30, 74, 118].map((y) => (
            <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="var(--color-divider)" strokeWidth="1" opacity={y === 118 ? 0.5 : 0.2} />
          ))}
          <path d={chart.areaPath} fill="url(#reportAreaFade)" stroke="none" className="chart-area-fade" />
          <polyline
            points={chart.linePoints}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.5"
            pathLength={1}
            className="chart-line-draw"
          />
          {chart.points.map((p, i) => (
            <g key={i} className="chart-point" style={{ ["--i" as string]: i }}>
              <circle cx={p.x} cy={p.y} r="4.5" fill={p.dotColor} stroke={p.dotStroke} strokeWidth="2" />
              {/* SVG <text> can't hold the <Amount> span, so the same mask
                  class is applied directly here for the dim/opacity styling
                  — only relevant in earnings mode, since hours were never
                  considered sensitive. The actual hiding, though, comes from
                  swapping the text content itself rather than relying on the
                  class's `filter: blur()`: WebKit on iOS doesn't reliably
                  apply CSS blur filters to SVG <text> glyphs (a known
                  cross-browser quirk, unlike every other Amount usage in
                  this app, which are plain HTML elements where blur works
                  fine) — that gap let the real figure show through on
                  mobile despite the eye toggle being on. */}
              <text
                x={p.x}
                y={p.labelY}
                fontSize="10"
                textAnchor="middle"
                fill="var(--color-text)"
                opacity="0.7"
                className={metric === "earnings" ? `amount-mask${earningsHidden ? " is-hidden" : ""}` : undefined}
              >
                {metric === "earnings" && earningsHidden ? "••••" : p.valueLabel}
              </text>
            </g>
          ))}
        </svg>
        <div className="chart-x-labels">
          {chart.points.map((p, i) => (
            <div className="chart-x-label" key={i} style={{ ["--i" as string]: i }}>
              {p.short}
            </div>
          ))}
        </div>
      </div>

      <div className="card elev-sm anim-rise" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 2 }}>
        <div className="card-kicker">Goals this week</div>
        <div className="ring-goal-row">
          <div className="ring-goal-col">
            <GoalRing pct={progressPct} value={`${progressPctAnim}%`} size={88} strokeWidth={9} />
            <div className="ring-goal-label">Hours</div>
            <div className="card-meta">{fmt2(totalHours)}h of {user.goalHours}h</div>
          </div>
          <div className="ring-goal-col">
            <GoalRing pct={earningsProgressPct} value={`${earningsProgressPctAnim}%`} size={88} strokeWidth={9} />
            <div className="ring-goal-label">Earnings</div>
            <div className="card-meta">
              <Amount>{CURRENCY}{fmt2(totalEarnings)} of {CURRENCY}{user.goalEarnings}</Amount>
            </div>
          </div>
        </div>
        <div className="hr" style={{ margin: "var(--space-2) 0 var(--space-3)" }} />
        <p className="card-body" style={{ textAlign: "center", margin: 0 }}>
          <span className="count-value" style={{ fontFamily: "var(--font-heading)", fontWeight: 800, color: "var(--color-text)" }}>
            {metGoalAnim} of {history.length}
          </span>{" "}
          weeks met your <Amount>{CURRENCY}{user.goalEarnings}</Amount> weekly goal.
        </p>
      </div>

      <div className="card elev-sm anim-rise" style={{ ["--i" as string]: 3 }}>
        <h6 className="section-title" style={{ margin: 0 }}>Compare periods</h6>
        <div className="section-hint" style={{ marginBottom: "var(--space-3)" }}>
          Week over week, month over month, or year over year — showing {metricLabel} (change the view above to switch).
        </div>
        <div className="seg" style={{ marginBottom: "var(--space-4)" }}>
          <label className="seg-opt">
            <input type="radio" name="period" checked={period === "week"} onChange={() => setPeriod("week")} /> Weeks
          </label>
          <label className="seg-opt">
            <input type="radio" name="period" checked={period === "month"} onChange={() => setPeriod("month")} /> Months
          </label>
          <label className="seg-opt">
            <input type="radio" name="period" checked={period === "year"} onChange={() => setPeriod("year")} /> Years
          </label>
        </div>
        <div className="period-bars">
          {periodBars.map((b, i) => (
            <div className="period-bar-col" key={i} style={{ ["--i" as string]: i }}>
              <div className="period-bar-label">{metric === "earnings" ? <Amount>{b.valueLabel}</Amount> : b.valueLabel}</div>
              <div className="period-bar-fill" style={{ height: b.barStyle, background: b.barColor }} />
              <div className="period-bar-label">{b.short}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
