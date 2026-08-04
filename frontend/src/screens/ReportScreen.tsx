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
  weekTotals,
} from "../lib/aggregate";
import { buildWeekDays } from "../lib/date";
import { buildWeekReportData } from "../lib/reportData";
import { generateReportPdf } from "../pdf/generateReportPdf";

type Metric = "earnings" | "hours";
type Period = "week" | "month" | "year";

export function ReportScreen() {
  const { today, user, shifts } = useApp();
  const [metric, setMetric] = useState<Metric>("earnings");
  const [period, setPeriod] = useState<Period>("week");

  if (!user) return null;

  const weekDays = buildWeekDays(today, user.weekStartsOn);
  const shiftsByDate = groupByDate(shifts);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, CURRENCY, user.rate);
  const { hours: totalHours, earnings: totalEarnings } = weekTotals(days, user.rate);

  const history = buildWeeklyHistory(shifts, today, user.weekStartsOn, user.rate, 7);
  const chartSource = buildChartSource(history, totalHours, totalEarnings);
  const chart = buildChart(chartSource, metric, CURRENCY);

  const progressPct = user.goalHours > 0 ? Math.min(100, Math.round((totalHours / user.goalHours) * 100)) : 0;
  const earningsProgressPct = user.goalEarnings > 0 ? Math.min(100, Math.round((totalEarnings / user.goalEarnings) * 100)) : 0;
  const metGoalCount = history.filter((w) => w.earnings >= user.goalEarnings).length;

  const periodItems =
    period === "month"
      ? buildMonthlyItems(shifts, today, user.rate, 6)
      : period === "year"
        ? buildYearlyItems(shifts, today, user.rate, 2)
        : chartSource;
  const periodBars = buildBars(periodItems, metric, CURRENCY);

  function handleDownloadPdf() {
    void generateReportPdf(buildWeekReportData(user!, shifts, today, CURRENCY));
  }

  return (
    <>
      <div className="row-baseline">
        <h6 className="section-title">Progress report</h6>
        <button className="btn btn-ghost" onClick={handleDownloadPdf} style={{ flex: "none" }}>
          Download this week (PDF)
        </button>
      </div>
      <div className="section-hint">Last 7 weeks plus this week in progress.</div>

      <div className="seg" style={{ marginBottom: "var(--space-4)" }}>
        <label className="seg-opt">
          <input type="radio" name="metric" checked={metric === "earnings"} onChange={() => setMetric("earnings")} /> Earnings
        </label>
        <label className="seg-opt">
          <input type="radio" name="metric" checked={metric === "hours"} onChange={() => setMetric("hours")} /> Hours
        </label>
      </div>

      <svg viewBox="0 0 320 150" width="100%" height="150" preserveAspectRatio="none" className="chart-svg">
        <line x1="0" y1="118" x2="320" y2="118" stroke="var(--color-divider)" strokeWidth="1" />
        <path d={chart.areaPath} fill="var(--color-accent-100)" stroke="none" />
        <polyline points={chart.linePoints} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" />
        {chart.points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4.5" fill={p.dotColor} stroke={p.dotStroke} strokeWidth="2" />
            <text x={p.x} y={p.labelY} fontSize="10" textAnchor="middle" fill="var(--color-text)" opacity="0.7">
              {p.valueLabel}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-x-labels">
        {chart.points.map((p, i) => (
          <div className="chart-x-label" key={i}>
            {p.short}
          </div>
        ))}
      </div>

      <div className="hr" />

      <div className="goal-rows">
        <div>
          <div className="progress-label-row">
            <span>Hours vs. goal</span>
            <span>{progressPct}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <div>
          <div className="progress-label-row">
            <span>Earnings vs. goal</span>
            <span>{earningsProgressPct}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${earningsProgressPct}%` }} />
          </div>
        </div>
      </div>

      <div className="card consistency-card">
        <div className="card-kicker">Consistency</div>
        <div className="card-title consistency-value">
          {metGoalCount} of {history.length} weeks
        </div>
        <p className="card-body">
          met your {CURRENCY}
          {user.goalEarnings} weekly goal, over the last {history.length} completed weeks.
        </p>
      </div>

      <div className="hr compare-hr" />
      <div className="row-baseline" style={{ marginBottom: "var(--space-1)" }}>
        <h6 className="section-title" style={{ margin: 0 }}>
          Compare periods
        </h6>
      </div>
      <div className="section-hint">See how you're doing week over week, month over month, or year over year.</div>
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
          <div className="period-bar-col" key={i}>
            <div className="period-bar-label">{b.valueLabel}</div>
            <div className="period-bar-fill" style={{ height: b.barStyle, background: b.barColor }} />
            <div className="period-bar-label">{b.short}</div>
          </div>
        ))}
      </div>
    </>
  );
}
