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
  isDateInWeek,
  weekExtraFor,
  weekTotals,
} from "../lib/aggregate";
import { buildWeekDays, fmt2, isoDate } from "../lib/date";
import { usePdfDownload } from "../lib/usePdfDownload";
import { useCountUp } from "../lib/useCountUp";
import { useLiveElapsedHours } from "../lib/useLiveElapsedHours";
import { useTodayShift } from "../lib/useTodayShift";
import { isDateInRange, withLiveInProgressPeriod } from "../lib/liveShiftVisuals";
import { Skeleton } from "../components/Skeleton";
import { GoalRing } from "../components/GoalRing";
import { Amount } from "../components/Amount";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";
import { BubbleLoader } from "../components/BubbleLoader";
import { StatusBanner } from "../components/StatusBanner";
import { ChartDataTable } from "../components/ChartDataTable";
import { StableLabel } from "../components/StableLabel";
import { EmptyState } from "../components/EmptyState";
import { ReportIcon } from "../components/icons";
import { LiveDataBadge } from "../components/LiveDataBadge";

type Metric = "earnings" | "hours";
type Period = "week" | "month" | "year";

export function ReportScreen() {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras, earningsHidden } = useApp();
  const { active, last } = useTodayShift();
  const [metric, setMetric] = useState<Metric>("earnings");
  const [period, setPeriod] = useState<Period>("week");
  const {
    download: downloadPdf,
    downloading: pdfDownloading,
    justDownloaded: pdfJustDownloaded,
    error: pdfError,
    clearError: clearPdfError,
  } = usePdfDownload();

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
  const { hours: savedHours, earnings: weekEarnings } = weekTotals(days, rate);
  const savedEarnings = weekEarnings + (weekExtraFor(weekStartISO, weekExtras)?.amount ?? 0);
  const openLiveHours = useLiveElapsedHours(active, last?.signIn ?? null);
  const activeShiftInThisWeek = !!last && isDateInWeek(last.date, weekDays);
  const liveHours = activeShiftInThisWeek ? openLiveHours : 0;
  const ticking = active && liveHours > 0;
  const totalHours = savedHours + liveHours;
  const totalEarnings = savedEarnings + liveHours * rate;

  const history = buildWeeklyHistory(shifts, today, weekStartsOn, rate, 7, new Date(createdAt), dayExpenses, weekExtras);
  const chartSource = buildChartSource(history, totalHours, totalEarnings);
  const chart = buildChart(chartSource, metric, CURRENCY);

  const progressPct = goalHours > 0 ? Math.min(100, (totalHours / goalHours) * 100) : 0;
  const earningsProgressPct = goalEarnings > 0 ? Math.min(100, (totalEarnings / goalEarnings) * 100) : 0;
  const savedProgressPct = goalHours > 0 ? Math.min(100, (savedHours / goalHours) * 100) : 0;
  const savedEarningsProgressPct = goalEarnings > 0 ? Math.min(100, (savedEarnings / goalEarnings) * 100) : 0;
  const metGoalCount = history.filter((w) => w.earnings >= goalEarnings).length;
  const metGoalAnim = Math.round(useCountUp(metGoalCount, 450));
  const progressPctTween = useCountUp(ticking ? savedProgressPct : progressPct, 550);
  const earningsProgressPctTween = useCountUp(ticking ? savedEarningsProgressPct : earningsProgressPct, 550);
  const progressPctAnim = Math.round(ticking ? progressPct : progressPctTween);
  const earningsProgressPctAnim = Math.round(ticking ? earningsProgressPct : earningsProgressPctTween);

  const settledPeriodItems =
    period === "month"
      ? buildMonthlyItems(shifts, today, rate, 6, dayExpenses, weekExtras)
      : period === "year"
        ? buildYearlyItems(shifts, today, rate, 2, dayExpenses, weekExtras)
        : chartSource;
  const activePeriod = settledPeriodItems.find((item) => item.inProgress);
  const periodLiveHours = period === "week"
    ? 0
    : activePeriod && isDateInRange(last?.date ?? null, activePeriod.startISO, activePeriod.endISO)
      ? openLiveHours
      : 0;
  const periodItems = period === "week"
    ? settledPeriodItems
    : withLiveInProgressPeriod(settledPeriodItems, periodLiveHours, rate);
  const periodBars = buildBars(periodItems, metric, CURRENCY);

  if (!user) return null;
  if (!shiftsLoaded) {
    return (
      <div className="screen-wide">
        <h1 className="section-title">Progress report</h1>
        <Skeleton className="skeleton-card" style={{ height: 76 }} />
        <Skeleton className="skeleton-chart" />
        <Skeleton className="skeleton-bars" />
      </div>
    );
  }

  function handleDownloadPdf() {
    void downloadPdf({ user: user!, today, currency: CURRENCY });
  }

  const metricLabel = metric === "earnings" ? "earnings" : "hours";
  const hasTrendData = history.some((week) => (metric === "earnings" ? week.earnings : week.hours) > 0)
    || (ticking && (metric === "earnings" ? totalEarnings : totalHours) > 0);
  // The one-line name for the line chart. Deliberately describes the shape
  // and range rather than reciting every value — the full figures are in
  // the table beneath it, and an aria-label that reads out eight numbers is
  // unusable as a graphic's name.
  const chartSummary =
    chart.points.length === 0
      ? `Weekly ${metricLabel} trend — no data yet`
      : `Line chart of weekly ${metricLabel} over the last ${chart.points.length} weeks, ` +
        `from ${chart.points[0].short} to ${chart.points[chart.points.length - 1].short}. ` +
        `Figures follow in the table below.`;

  return (
    <div className="screen-wide">
      <div className="row-baseline">
        <h1 className="section-title">Progress report</h1>
        {/* `.btn-secondary` (a real filled pill), not `.btn-ghost` (bare
            colored text) — `.row-baseline` wraps this onto its own line on
            a phone-width card (the full "Download this week (PDF)" label
            plus "Progress report" doesn't fit on one line even on a
            standard-width phone), and a ghost button alone on a line, in
            the same bold heading font as the title above it, read as a
            second oversized heading rather than a tappable button. A short
            label also makes that wrap far less likely to begin with. */}
        {/* Three states, three different natural widths ("Download PDF" ->
            a spinner -> "Downloaded ✓"), so the button used to resize twice
            per download and shove the heading beside it around each time.
            StableLabel reserves the widest variant's box up front; the
            spinner is absolutely positioned inside it so it doesn't
            contribute width either. */}
        <button
          className={`btn btn-secondary btn-stable${pdfJustDownloaded ? " btn-save-flash" : ""}`}
          onClick={handleDownloadPdf}
          disabled={pdfDownloading}
          aria-busy={pdfDownloading || undefined}
          style={{ flex: "none" }}
        >
          {pdfDownloading && (
            <span className="btn-stable-overlay">
              <BubbleLoader label="Preparing PDF" />
            </span>
          )}
          <span className={pdfDownloading ? "btn-stable-hidden" : undefined}>
            <StableLabel
              current={pdfJustDownloaded ? "Downloaded ✓" : "Download PDF"}
              longest="Downloaded ✓"
            />
          </span>
        </button>
      </div>
      <div className="section-hint">Last 7 weeks plus this week in progress.</div>
      {/* Dismissal used to be an onClick on the <div> itself — no button, no
          label, no keyboard route, and nothing on screen suggesting the
          message could be cleared at all. */}
      {pdfError && (
        <StatusBanner tone="danger" onDismiss={clearPdfError} dismissLabel="Dismiss this error">
          {pdfError}
        </StatusBanner>
      )}

      {/* Headline numbers up front, before any chart — answers "how am I
          doing this week" in one glance instead of making that the reward
          for reading a chart first. */}
      <div className="card elev-sm anim-rise report-hero-card" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 0 }}>
        <div className="live-visual-status-row report-live-status"><span className="card-meta">Current week</span></div>
        <div className="report-hero-row">
          <div>
            <div className="card-kicker">This week's earnings</div>
            <div className="week-amount count-value live-metric-value">
              <Amount>{CURRENCY}{fmt2(totalEarnings)}</Amount>
            </div>
          </div>
          <div className="report-hero-divider" aria-hidden="true" />
          <div>
            <div className="card-kicker">This week's hours</div>
            <div className="week-amount count-value report-hero-hours live-metric-value">{fmt2(totalHours)}h</div>
          </div>
        </div>
        <EarningsHiddenHint />
      </div>

      <div className="card elev-sm anim-rise" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 1 }}>
        <div className="row-baseline">
          <div className="chart-heading-kicker"><div className="card-kicker">Weekly trend</div><LiveDataBadge active={ticking} /></div>
          <fieldset className="fieldset-plain fieldset-inline">
            <legend className="visually-hidden">Weekly trend metric</legend>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" name="metric" checked={metric === "earnings"} onChange={() => setMetric("earnings")} /> Earnings
              </label>
              <label className="seg-opt">
                <input type="radio" name="metric" checked={metric === "hours"} onChange={() => setMetric("hours")} /> Hours
              </label>
            </div>
          </fieldset>
        </div>

        {/* `width="100%"` with no fixed `height` and no `preserveAspectRatio`
            override lets the default uniform ("meet") scaling do the work —
            paired with the CSS `aspect-ratio` on .chart-svg matching this
            viewBox exactly, the chart scales the same in x and y at every
            container width. It used to force height to a flat 150px (190px
            on tablet, 220px on desktop) while width flexed independently,
            which stretched the dots into ellipses and the line out of
            proportion on anything other than a ~320px-wide phone. */}
        {/* The chart carried no accessible information whatsoever: an <svg>
            with no name, no role, and values living only in <text> nodes
            positioned by coordinate. To a screen reader it was a run of
            unlabelled numbers in visual order with nothing saying what they
            measured or which week each belonged to.
            Two changes: the graphic names itself and is excluded from the
            reading order (role="img" + aria-label), and the same data is
            published once, properly, as a real table for anyone who can't
            use the picture. The table is the source of truth for assistive
            tech; the drawing is the enhancement. */}
        {hasTrendData ? <>
        <svg viewBox="0 0 320 150" width="100%" className="chart-svg" role="img" aria-label={chartSummary}>
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
            <g key={i} className={`chart-point${p.inProgress && ticking ? " is-live" : ""}`} style={{ ["--i" as string]: i }}>
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
                textAnchor={p.labelAnchor}
                fill="var(--color-text)"
                opacity="0.7"
                className={metric === "earnings" ? `amount-mask${earningsHidden ? " is-hidden" : ""}` : undefined}
              >
                {metric === "earnings" && earningsHidden ? "••••" : p.valueLabel}
              </text>
            </g>
          ))}
        </svg>
        <div className="chart-x-labels" aria-hidden="true">
          {chart.points.map((p, i) => (
            <div className="chart-x-label" key={i} style={{ ["--i" as string]: i }}>
              {p.short}
            </div>
          ))}
        </div>

        <ChartDataTable
          caption={`Weekly ${metricLabel}, oldest first`}
          valueHeading={metric === "earnings" ? "Earnings" : "Hours"}
          rows={chart.points.map((p) => ({
            label: p.short,
            value: metric === "earnings" && earningsHidden ? "Hidden" : p.valueLabel,
          }))}
        />
        </> : (
          <div className="report-chart-empty">
            <EmptyState
              compact
              icon={<ReportIcon size={25} />}
              title="Your trend starts here"
              description="Complete your first weekly cycle to compare this week with earlier weeks."
            />
          </div>
        )}
      </div>

      <div className="card elev-sm anim-rise" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 2 }}>
          <div className="card-kicker">Goals this week</div>
        <div className="ring-goal-row">
          <div className="ring-goal-col">
            <GoalRing pct={progressPct} value={`${progressPctAnim}%`} size={88} strokeWidth={9} live={ticking} />
            <div className="ring-goal-label">Hours</div>
            <div className="card-meta">{fmt2(totalHours)}h of {user.goalHours}h</div>
          </div>
          <div className="ring-goal-col">
            <GoalRing pct={earningsProgressPct} value={`${earningsProgressPctAnim}%`} size={88} strokeWidth={9} live={ticking} />
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
        <h2 className="section-title" style={{ margin: 0 }}>Compare periods</h2>
        <div className="section-hint" style={{ marginBottom: "var(--space-3)" }}>
          Week over week, month over month, or year over year — showing {metricLabel} (change the view above to switch).
        </div>
        <fieldset className="fieldset-plain">
          <legend className="visually-hidden">Compare by period</legend>
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
        </fieldset>
        {/* Same problem as the line chart above: a row of unlabelled divs
            whose only textual content was a value and a short period name
            with nothing tying them together. Hidden from assistive tech and
            replaced by the table. */}
        <div className="period-bars" aria-hidden="true">
          {periodBars.map((b, i) => (
            <div className={`period-bar-col${b.inProgress && (period === "week" ? ticking : periodLiveHours > 0) ? " is-live" : ""}`} key={i} style={{ ["--i" as string]: i }}>
              <div className="period-bar-label">{metric === "earnings" ? <Amount>{b.valueLabel}</Amount> : b.valueLabel}</div>
              <div className="period-bar-fill" style={{ height: b.barStyle, background: b.barColor }} />
              <div className="period-bar-label">{b.short}</div>
            </div>
          ))}
        </div>
        <ChartDataTable
          caption={`${period === "week" ? "Weekly" : period === "month" ? "Monthly" : "Yearly"} ${metricLabel}, oldest first`}
          labelHeading={period === "week" ? "Week" : period === "month" ? "Month" : "Year"}
          valueHeading={metric === "earnings" ? "Earnings" : "Hours"}
          rows={periodBars.map((b) => ({
            label: b.short,
            value: metric === "earnings" && earningsHidden ? "Hidden" : b.valueLabel,
          }))}
        />
      </div>
    </div>
  );
}
