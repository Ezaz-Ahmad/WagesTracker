import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import {
  buildWeekDaysComputed,
  buildWeeklyHistory,
  computeStreak,
  groupByDate,
  groupExpensesByDate,
  isDateInWeek,
  weekExtraFor,
  weekTotals,
} from "../lib/aggregate";
import { addDays, buildWeekDays, computeHours, fmt2, formatTime12, isoDate, parseIsoDate } from "../lib/date";
import { compareWeekEarnings } from "../lib/weekComparison";
import { useTodayShift } from "../lib/useTodayShift";
import { useCountUp } from "../lib/useCountUp";
import { useLiveElapsedHours } from "../lib/useLiveElapsedHours";
import { ElapsedTimer, ShiftButton } from "../components/ShiftButton";
import { GoalRing } from "../components/GoalRing";
import { ChevronRightIcon, EntryIcon, FlameIcon, HistoryIcon, SlidersIcon, SpendingIcon, TrophyIcon } from "../components/icons";
import { Skeleton } from "../components/Skeleton";
import { Amount } from "../components/Amount";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";
import { ChartDataTable } from "../components/ChartDataTable";
import { LiveDataBadge } from "../components/LiveDataBadge";
import { useSpendingSummary } from "../lib/spendingDataCache";
import { withLiveDay, withLiveSpendingEarnings } from "../lib/liveShiftVisuals";
import type { DayExpense, Screen, Shift, SpendingSummary, WeekExtra, WeekStart } from "../lib/types";
import { useLayoutPreferences, type HomeWidgetId } from "../context/LayoutPreferencesContext";
import { useFlipAnimation } from "../lib/useFlipAnimation";
import { HomeInsightSheet } from "../components/HomeInsightSheet";
import { WorkLocationPicker, WorkLocationTrigger } from "../components/WorkLocationPicker";

type HomeDay = ReturnType<typeof buildWeekDaysComputed>[number];

function homeSnapshotCategories(summary: SpendingSummary) {
  if (summary.categories.length <= 4) return summary.categories;
  const leading = summary.categories.slice(0, 3);
  const remaining = summary.categories.slice(3);
  return [
    ...leading,
    {
      id: "home-other-categories",
      name: "Other categories",
      icon: "other" as const,
      colour: "#475569" as const,
      totalCents: remaining.reduce((total, category) => total + category.totalCents, 0),
      transactionCount: remaining.reduce((total, category) => total + category.transactionCount, 0),
    },
  ];
}

function donutBackground(summary: SpendingSummary): string | undefined {
  if (summary.totalSpendingCents <= 0) return undefined;
  let progress = 0;
  const stops = homeSnapshotCategories(summary).map((category) => {
    const start = progress;
    progress += (category.totalCents / summary.totalSpendingCents) * 100;
    return `${category.colour} ${start}% ${progress}%`;
  });
  return `conic-gradient(${stops.join(",")})`;
}

export function formatHomeDonutAmount(totalCents: number): { display: string; full: string; fit: "regular" | "medium" | "tight" | "compact" } {
  const dollars = Math.max(0, totalCents) / 100;
  const full = `${CURRENCY}${dollars.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (dollars >= 100_000) {
    const compact = dollars.toLocaleString("en-AU", { notation: "compact", maximumFractionDigits: 1 });
    return { display: `${CURRENCY}${compact}`, full, fit: "compact" };
  }
  if (full.length >= 10) return { display: full, full, fit: "tight" };
  if (full.length >= 8) return { display: full, full, fit: "medium" };
  return { display: full, full, fit: "regular" };
}

function categoryPercentage(categoryCents: number, totalCents: number): string {
  const percentage = (categoryCents / Math.max(1, totalCents)) * 100;
  return `${percentage > 0 && percentage < 10 ? percentage.toFixed(1) : percentage.toFixed(0)}%`;
}

function clampProgress(hours: number, goalHours: number): number {
  const raw = goalHours > 0 ? (hours / goalHours) * 100 : 0;
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
}

function LiveWeekSummaryCard(props: {
  active: boolean;
  signIn: string | null;
  activeShiftInThisWeek: boolean;
  savedHours: number;
  savedEarnings: number;
  rate: number;
  goalHours: number;
  today: Date;
  weekStartsOn: WeekStart;
  shifts: Shift[];
  dayExpenses: DayExpense[];
  weekExtras: WeekExtra[];
  earningsHidden: boolean;
}) {
  const ticking = props.active && props.activeShiftInThisWeek;
  const liveHours = useLiveElapsedHours(ticking, props.signIn);
  const totalHours = props.savedHours + liveHours;
  const totalEarnings = props.savedEarnings + liveHours * props.rate;
  const progressPct = clampProgress(totalHours, props.goalHours);
  // Do not continuously retarget an rAF count-up while a shift is running.
  // The live value is exact; the tween remains for one-off settled changes.
  const earningsSmoothed = useCountUp(ticking ? props.savedEarnings : totalEarnings, 650);
  const progressSmoothed = Math.round(useCountUp(ticking ? clampProgress(props.savedHours, props.goalHours) : progressPct, 550));
  const displayEarnings = ticking ? totalEarnings : earningsSmoothed;
  const displayProgress = ticking ? Math.round(progressPct) : progressSmoothed;
  const comparison = compareWeekEarnings({
    today: props.today,
    weekStartsOn: props.weekStartsOn,
    shifts: props.shifts,
    dayExpenses: props.dayExpenses,
    weekExtras: props.weekExtras,
    rate: props.rate,
    liveEarnings: liveHours * props.rate,
  });

  return (
    <div className="card elev-sm">
      <div className="week-card-top">
        <div className="week-amount count-value live-number-slot">
          <Amount>{CURRENCY}{fmt2(displayEarnings)}</Amount>
        </div>
        {props.earningsHidden ? (
          <div className="week-trend is-muted">Earnings hidden</div>
        ) : (
          <div className={`week-trend is-${comparison.direction}`} title={comparison.isEstimate ? "Includes the shift currently in progress" : undefined}>
            {comparison.direction === "up" ? "▲ " : comparison.direction === "down" ? "▼ " : ""}
            {comparison.label}
            {comparison.isEstimate && comparison.direction !== "none" ? " (est.)" : ""}
          </div>
        )}
      </div>
      <EarningsHiddenHint />
      <div className="card-meta live-hours-slot" style={{ marginTop: 2 }}>
        {fmt2(totalHours)}h logged · goal {props.goalHours}h
      </div>
      <div className="hr" style={{ margin: "var(--space-3) 0" }} />
      <div className="progress-label-row" id="home-goal-progress-label">
        <span>Hours toward goal</span>
        <span className="count-value live-progress-slot">{displayProgress}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-labelledby="home-goal-progress-label">
        <div className="progress-fill" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

function WeekGlanceCard(props: {
  days: HomeDay[];
  earningsHidden: boolean;
  active: boolean;
  signIn: string | null;
  activeShiftInThisWeek: boolean;
  activeShiftDate: string | null;
  rate: number;
}) {
  const barRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const ticking = props.active && props.activeShiftInThisWeek;
  const liveHours = useLiveElapsedHours(ticking, props.signIn);
  const glanceDays = withLiveDay(props.days, props.activeShiftDate, liveHours, props.rate, CURRENCY).map((day) => ({
    ...day,
    displayHours: day.hours,
  }));
  const maxGlanceHours = Math.max(...glanceDays.map((day) => day.displayHours), 1);
  // Keep the chart compact on first render. Day details are an intentional
  // disclosure: they appear only after the user selects a bar, rather than
  // making the current day look selected before any interaction.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDate && !glanceDays.some((day) => day.dateISO === selectedDate)) setSelectedDate(null);
  }, [glanceDays, selectedDate]);

  const selectedDay = selectedDate ? glanceDays.find((day) => day.dateISO === selectedDate) : undefined;
  const recordedShifts = selectedDay?.shifts.filter((shift) => shift.signIn || shift.signOut || shift.location) ?? [];
  const branches = [...new Set(recordedShifts.map((shift) => shift.location.trim()).filter(Boolean))];
  const selectedIsActive = Boolean(ticking && selectedDay?.dateISO === props.activeShiftDate);

  const selectByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = Math.min(glanceDays.length - 1, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = glanceDays.length - 1;
    else return;
    event.preventDefault();
    barRefs.current[nextIndex]?.focus();
  };

  return (
    <>
      <div className="card elev-sm glance-card">
        <div className="live-visual-status-row">
          <span className="card-meta">Current week</span>
          <LiveDataBadge active={ticking} label="Updating live" />
        </div>
        <div className="glance-bars" role="group" aria-label="Select a day to review this week's details">
          {glanceDays.map((day, index) => {
            const pct = Math.max(4, (day.displayHours / maxGlanceHours) * 100);
            const worked = day.displayHours > 0;
            return (
              <button
                type="button"
                key={day.dateISO}
                ref={(element) => { barRefs.current[index] = element; }}
                className={`glance-bar-col${day.isToday ? " is-today" : ""}${ticking && day.dateISO === props.activeShiftDate ? " is-live" : ""}${selectedDate === day.dateISO ? " is-selected" : ""}`}
                style={{ ["--i" as string]: index }}
                aria-pressed={selectedDate === day.dateISO}
                aria-haspopup="dialog"
                aria-expanded={selectedDate === day.dateISO}
                aria-label={`${day.dayAbbr} ${day.dateLabel}, ${worked ? `${fmt2(day.displayHours)} hours${props.earningsHidden ? "" : `, ${day.moneyLabel}`}` : "no entry"}${ticking && day.dateISO === props.activeShiftDate ? ", shift active" : ""}`}
                onClick={() => setSelectedDate(day.dateISO)}
                onKeyDown={(event) => selectByKeyboard(event, index)}
              >
                <span className="glance-bar-track" aria-hidden="true"><span className={`glance-bar-fill${worked ? " is-worked" : ""}`} style={{ height: `${pct.toFixed(4)}%` }} /></span>
                <span className="glance-bar-label" aria-hidden="true">{day.dayAbbr.charAt(0)}</span>
              </button>
            );
          })}
        </div>
        <ChartDataTable
          caption="Hours worked each day this week"
          labelHeading="Day"
          valueHeading="Hours"
          rows={glanceDays.map((day) => ({ label: `${day.dayAbbr} ${day.dateLabel}`, value: day.displayHours > 0 ? `${fmt2(day.displayHours)}h` : "No entry" }))}
        />
      </div>

      {selectedDay && (
        <HomeInsightSheet
          eyebrow="Day details"
          title={parseIsoDate(selectedDay.dateISO).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
          description={recordedShifts.length ? `${recordedShifts.length} ${recordedShifts.length === 1 ? "shift" : "shifts"} recorded for this day.` : "No shift has been logged for this day yet."}
          icon={<EntryIcon size={20} />}
          live={selectedIsActive}
          onClose={() => setSelectedDate(null)}
        >
          <dl className="home-insight-metrics">
            <div><dt>Hours</dt><dd className="live-number-slot">{selectedDay.displayHours > 0 ? `${fmt2(selectedDay.displayHours)}h` : "—"}</dd></div>
            {!props.earningsHidden && <div><dt>Earnings</dt><dd className="live-number-slot" aria-live={selectedIsActive ? "polite" : undefined} aria-atomic={selectedIsActive ? "true" : undefined}>{selectedDay.moneyLabel}</dd></div>}
            {props.earningsHidden && <div><dt>Status</dt><dd>{selectedIsActive ? "Live" : selectedDay.displayHours > 0 ? "Logged" : "No entry"}</dd></div>}
            <div><dt>Shifts</dt><dd>{recordedShifts.length || "—"}</dd></div>
            <div><dt>Fuel</dt><dd>{selectedDay.fuelCostLabel}</dd></div>
          </dl>

          <div className="home-insight-section">
            <h3 className="home-insight-section-title">Shift timeline</h3>
            {recordedShifts.length ? (
              <ul className="home-insight-list">
                {recordedShifts.map((shift, index) => (
                  <li key={shift.id ?? `${selectedDay.dateISO}-${index}`}>
                    <span className={`home-insight-row-marker${shift.signIn ? " is-positive" : ""}`} aria-hidden="true">{index + 1}</span>
                    <span className="home-insight-row-copy">
                      <strong>{shift.location || "Branch not recorded"}</strong>
                      <span>{formatTime12(shift.signIn)} – {shift.signOut ? formatTime12(shift.signOut) : "In progress"}</span>
                    </span>
                    <span className={`home-insight-row-value${!shift.signOut && selectedIsActive ? " is-positive" : ""}`}>{!shift.signOut && selectedIsActive ? "Live" : shift.hoursLabel}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="home-insight-empty">Nothing logged here yet. Add a shift from the Entry tab whenever you’re ready.</p>}
          </div>

          <p className="home-insight-note"><span><strong>{branches.length === 1 ? "Branch:" : "Branches:"}</strong> {branches.length ? branches.join(" · ") : "No branch recorded"}</span></p>
        </HomeInsightSheet>
      )}
    </>
  );
}

function HomeSpendingSkeleton() {
  return (
    <div className="home-spending-content home-spending-skeleton" aria-label="Loading this month's spending" aria-busy="true">
      <span className="visually-hidden">Loading this month's spending</span>
      <div className="home-spending-chart-row" aria-hidden="true">
        <span className="data-skeleton is-donut" />
        <div className="home-spending-skeleton-legend">{[0, 1, 2, 3].map((item) => <span className="data-skeleton is-line" key={item} />)}</div>
      </div>
      <div className="home-spending-values" aria-hidden="true">{[0, 1, 2].map((item) => <div key={item}><span className="data-skeleton is-kicker" /><strong className="data-skeleton is-value" /></div>)}</div>
      <span className="data-skeleton home-spending-skeleton-button" aria-hidden="true" />
    </div>
  );
}

function HomeSpendingSnapshotCard(props: {
  monthLabel: string;
  snapshot: SpendingSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<unknown>;
  onNavigate?: (screen: Screen) => void;
  active: boolean;
  signIn: string | null;
  activeShiftInMonth: boolean;
  rate: number;
}) {
  const ticking = props.active && props.activeShiftInMonth;
  const liveHours = useLiveElapsedHours(ticking, props.signIn);
  const summary = props.snapshot ? withLiveSpendingEarnings(props.snapshot, liveHours, props.rate) : null;
  const categories = summary ? homeSnapshotCategories(summary) : [];
  const donutAmount = summary ? formatHomeDonutAmount(summary.totalSpendingCents) : null;

  return (
    <section className="card elev-sm home-spending-snapshot" aria-labelledby="home-spending-title" aria-busy={props.loading || undefined}>
      <div className="home-spending-heading">
        <div className="home-spending-title-row"><SpendingIcon size={18} /><div><span className="card-kicker">Monthly snapshot</span><h2 id="home-spending-title" className="card-title">Personal spending — {props.monthLabel}</h2></div></div>
        <div className="home-spending-heading-status">
          {props.error && props.snapshot ? (
            <button type="button" className="home-spending-refresh-state is-warning" onClick={() => void props.refresh().catch(() => {})} title={props.error}>Retry refresh</button>
          ) : (
            <span className={`home-spending-updating${props.loading && props.snapshot ? " is-visible" : ""}`} aria-live="polite">Updating…</span>
          )}
        </div>
      </div>
      {summary ? (
        <div className="home-spending-content">
          <p className="visually-hidden">Personal spending for {props.monthLabel}: {CURRENCY}{fmt2(summary.totalSpendingCents / 100)}. {categories.map((category) => `${category.name} ${((category.totalCents / Math.max(1, summary.totalSpendingCents)) * 100).toFixed(1)} percent`).join(", ")}.</p>
          <div className="home-spending-chart-row">
            <div className="home-spending-donut" aria-hidden="true" style={{ background: donutBackground(summary) }} title={donutAmount?.full}>
              <div className={`home-spending-donut-center is-${donutAmount?.fit}`}>
                <strong>{donutAmount?.display}</strong><span>Spent this month</span>
              </div>
            </div>
            <ul className="home-spending-legend" aria-label={`${props.monthLabel} spending by category`}>
              {categories.length ? categories.map((category) => (
                <li key={category.id}><span style={{ backgroundColor: category.colour }} aria-hidden="true" /><span>{category.name}</span><strong>{categoryPercentage(category.totalCents, summary.totalSpendingCents)}</strong></li>
              )) : <li className="home-spending-empty">No expenses recorded this month.</li>}
            </ul>
          </div>
          <div className="home-spending-values">
            <div><span>Recorded earnings</span><strong className="live-metric-value"><Amount>{CURRENCY}{fmt2(summary.earningsCents / 100)}</Amount></strong></div>
            <div><span>Monthly spending</span><strong>{CURRENCY}{fmt2(summary.totalSpendingCents / 100)}</strong></div>
            <div><span>{summary.differenceCents < 0 ? "Over earnings" : "Remaining"}</span><strong className="live-metric-value"><Amount>{summary.differenceCents < 0 ? "−" : ""}{CURRENCY}{fmt2(Math.abs(summary.differenceCents) / 100)}</Amount></strong></div>
          </div>
          <button type="button" className="btn btn-secondary home-spending-cta" onClick={() => props.onNavigate?.("spending")}>View full spending dashboard <span aria-hidden="true">→</span></button>
        </div>
      ) : props.loading ? <HomeSpendingSkeleton /> : props.error ? (
        <div className="home-spending-error" role="alert"><span>{props.error}</span><button type="button" className="btn btn-secondary" onClick={() => void props.refresh().catch(() => {})}>Retry</button></div>
      ) : <div className="card-meta">Open Spending to record and review personal expenses.</div>}
    </section>
  );
}

interface HomeStatsValue {
  ticking: boolean;
  liveDays: HomeDay[];
  daysLogged: number;
  daysLoggedDisplay: number;
  daysLoggedPct: number;
  metGoalCount: number;
  metGoalDisplay: number;
  weeksOnGoalPct: number;
  historyLength: number;
  streak: number;
  streakDisplay: number;
  recentStreakDates: Array<{ dateISO: string; label: string }>;
  history: ReturnType<typeof buildWeeklyHistory>;
  goalEarnings: number;
  earningsHidden: boolean;
  bestDay?: HomeDay;
}

const HomeStatsContext = createContext<HomeStatsValue | null>(null);

function HomeStatsProvider(props: {
  days: HomeDay[];
  shifts: Shift[];
  history: ReturnType<typeof buildWeeklyHistory>;
  goalEarnings: number;
  today: Date;
  rate: number;
  active: boolean;
  signIn: string | null;
  activeShiftInThisWeek: boolean;
  activeShiftDate: string | null;
  earningsHidden: boolean;
  children: ReactNode;
}) {
  const ticking = props.active && props.activeShiftInThisWeek;
  const liveHours = useLiveElapsedHours(ticking, props.signIn);
  const liveDays = withLiveDay(props.days, props.activeShiftDate, liveHours, props.rate, CURRENCY);
  const { daysLogged } = weekTotals(liveDays, props.rate);
  const metGoalCount = props.history.filter((week) => week.earnings >= props.goalEarnings).length;
  const daysLoggedAnim = Math.round(useCountUp(daysLogged, 450));
  const metGoalAnim = Math.round(useCountUp(metGoalCount, 450));
  const daysLoggedPct = (daysLogged / 7) * 100;
  const weeksOnGoalPct = props.history.length > 0 ? (metGoalCount / props.history.length) * 100 : 0;

  const streakShifts = ticking && liveHours > 0 && props.activeShiftDate
    ? [...props.shifts, { id: "live-display", date: props.activeShiftDate, location: "", signIn: "00:00", signOut: "00:01" }]
    : props.shifts;
  const streak = computeStreak(groupByDate(streakShifts), props.today);
  const streakAnim = Math.round(useCountUp(streak, 450));
  const streakByDate = groupByDate(streakShifts);
  const dateHasHours = (date: Date) => (streakByDate.get(isoDate(date)) ?? []).some((shift) => computeHours(shift.signIn, shift.signOut) > 0);
  let streakCursor = props.today;
  if (!dateHasHours(streakCursor)) streakCursor = addDays(streakCursor, -1);
  const recentStreakDates = Array.from({ length: Math.min(streak, 7) }, (_, index) => {
    const date = addDays(streakCursor, -index);
    return {
      dateISO: isoDate(date),
      label: date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" }),
    };
  });

  let bestDay: HomeDay | undefined;
  let bestDayEarnings = 0;
  for (const day of liveDays) {
    const earnings = day.hours * props.rate + day.fuelCost;
    if (earnings > bestDayEarnings) {
      bestDayEarnings = earnings;
      bestDay = day;
    }
  }

  return (
    <HomeStatsContext.Provider value={{
      ticking,
      liveDays,
      daysLogged,
      daysLoggedDisplay: daysLoggedAnim,
      daysLoggedPct,
      metGoalCount,
      metGoalDisplay: metGoalAnim,
      weeksOnGoalPct,
      historyLength: props.history.length,
      streak,
      streakDisplay: streakAnim,
      recentStreakDates,
      history: props.history,
      goalEarnings: props.goalEarnings,
      earningsHidden: props.earningsHidden,
      bestDay,
    }}>
      {props.children}
    </HomeStatsContext.Provider>
  );
}

type HomeStatWidgetId = Extract<HomeWidgetId, "days-logged" | "weeks-on-goal" | "current-streak" | "best-day">;

function HomeStatWidget({ id, index }: { id: HomeStatWidgetId; index: number }) {
  const stats = useContext(HomeStatsContext);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!stats) return null;

  if (id === "best-day") return (
      <div data-flip-key={id} data-widget-id={id} className="card stat-tile home-widget home-widget-compact anim-rise" style={{ ["--i" as string]: index }}>
        <div className="card-kicker">Best day this week</div>
        <div className="card-title stat-tile-value stat-tile-icon-row">
          <TrophyIcon size={19} />
          <span>{stats.bestDay ? stats.bestDay.dayAbbr : "—"}</span>
        </div>
        <div className="card-meta live-metric-value">{stats.bestDay ? <Amount>{stats.bestDay.moneyLabel}</Amount> : "Log a shift to see it"}</div>
      </div>
  );

  const cardContent = id === "days-logged" ? (
    <>
      <div className="card-kicker">Days logged</div>
      <div className="stat-tile-ring-row">
        <GoalRing pct={stats.daysLoggedPct} value={`${stats.daysLoggedDisplay}/7`} live={stats.ticking} />
        <div className="card-meta stat-tile-ring-caption">days worked</div>
      </div>
    </>
  ) : id === "weeks-on-goal" ? (
    <>
      <div className="card-kicker">Weeks on goal</div>
      <div className="stat-tile-ring-row">
        <GoalRing pct={stats.weeksOnGoalPct} value={`${stats.metGoalDisplay}/${stats.historyLength}`} />
        <div className="card-meta stat-tile-ring-caption">on goal</div>
      </div>
    </>
  ) : (
    <>
      <div className="card-kicker">Current streak</div>
      <div className="card-title stat-tile-value stat-tile-icon-row">
        <FlameIcon size={19} />
        <span className="count-value">{stats.streakDisplay}</span>
      </div>
      <div className="card-meta">{stats.streak === 1 ? "day in a row" : "days in a row"}</div>
    </>
  );

  const sheet = id === "days-logged" ? (
    <HomeInsightSheet
      eyebrow="Days logged"
      title={`${stats.daysLogged} of 7 days worked`}
      description="Your completed and active workdays in the current week."
      icon={<EntryIcon size={20} />}
      live={stats.ticking}
      onClose={() => setDetailsOpen(false)}
    >
      <dl className="home-insight-metrics">
        <div><dt>Worked</dt><dd>{stats.daysLogged}</dd></div>
        <div><dt>Remaining</dt><dd>{7 - stats.daysLogged}</dd></div>
      </dl>
      <div className="home-insight-section">
        <h3 className="home-insight-section-title">This week</h3>
        <ul className="home-insight-list">
          {stats.liveDays.map((day) => {
            const worked = day.hours > 0;
            return (
              <li key={day.dateISO}>
                <span className={`home-insight-row-marker${worked ? " is-positive" : ""}`} aria-hidden="true">{worked ? "✓" : day.dayAbbr.charAt(0)}</span>
                <span className="home-insight-row-copy"><strong>{day.dayAbbr} · {day.dateLabel}{day.isToday ? " · Today" : ""}</strong><span>{worked ? "Work logged" : "No shift logged"}</span></span>
                <span className={`home-insight-row-value${worked ? " is-positive" : ""}`}>{worked ? `${fmt2(day.hours)}h` : "—"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </HomeInsightSheet>
  ) : id === "weeks-on-goal" ? (
    <HomeInsightSheet
      eyebrow="Weeks on goal"
      title={stats.historyLength ? `${stats.metGoalCount} of ${stats.historyLength} weeks` : "No completed weeks yet"}
      description="A seven-week lookback showing how often you reached your weekly earnings goal."
      icon={<HistoryIcon size={20} />}
      onClose={() => setDetailsOpen(false)}
    >
      <dl className="home-insight-metrics">
        <div><dt>Goal reached</dt><dd>{stats.metGoalCount}</dd></div>
        <div><dt>Success rate</dt><dd>{stats.historyLength ? `${Math.round(stats.weeksOnGoalPct)}%` : "—"}</dd></div>
      </dl>
      <div className="home-insight-section">
        <h3 className="home-insight-section-title">Completed weeks</h3>
        {stats.history.length ? (
          <ul className="home-insight-list">
            {[...stats.history].reverse().map((week) => {
              const metGoal = week.earnings >= stats.goalEarnings;
              return (
                <li key={week.startISO}>
                  <span className={`home-insight-row-marker${metGoal ? " is-positive" : ""}`} aria-hidden="true">{metGoal ? "✓" : "–"}</span>
                  <span className="home-insight-row-copy"><strong>{week.label}</strong><span>{fmt2(week.hours)}h logged</span></span>
                  <span className={`home-insight-row-value${metGoal ? " is-positive" : ""}`}>{stats.earningsHidden ? (metGoal ? "On goal" : "Below") : `${CURRENCY}${fmt2(week.earnings)}`}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="home-insight-empty">Your completed weeks will appear here as your history builds.</p>}
      </div>
      <p className="home-insight-note"><span><strong>Weekly target:</strong> {stats.earningsHidden ? "Hidden while earnings privacy is on" : `${CURRENCY}${fmt2(stats.goalEarnings)}`}.</span></p>
    </HomeInsightSheet>
  ) : (
    <HomeInsightSheet
      eyebrow="Current streak"
      title={stats.streak ? `${stats.streak} ${stats.streak === 1 ? "day" : "days"} in a row` : "Start your next streak"}
      description="Consecutive calendar days with completed work, including streaks that cross week boundaries."
      icon={<FlameIcon size={21} />}
      live={stats.ticking}
      onClose={() => setDetailsOpen(false)}
    >
      <dl className="home-insight-metrics">
        <div><dt>Current streak</dt><dd>{stats.streak}</dd></div>
        <div><dt>Status</dt><dd>{stats.streak ? "Active" : "Ready"}</dd></div>
      </dl>
      <div className="home-insight-section">
        <h3 className="home-insight-section-title">Recent streak days</h3>
        {stats.recentStreakDates.length ? (
          <ul className="home-insight-list">
            {stats.recentStreakDates.map((date, index) => (
              <li key={date.dateISO}>
                <span className="home-insight-row-marker is-positive" aria-hidden="true">✓</span>
                <span className="home-insight-row-copy"><strong>{date.label}</strong><span>Day {stats.streak - index} of your streak</span></span>
                <span className="home-insight-row-value is-positive">Logged</span>
              </li>
            ))}
          </ul>
        ) : <p className="home-insight-empty">Log work on consecutive days to begin building a streak.</p>}
      </div>
      <p className="home-insight-note"><span>Today will not break your streak while the day is still in progress. If nothing is logged today, the count continues from yesterday.</span></p>
    </HomeInsightSheet>
  );

  const accessibleLabel = id === "days-logged" ? "Days logged" : id === "weeks-on-goal" ? "Weeks on goal" : "Current streak";
  return (
    <>
      <button
        type="button"
        data-flip-key={id}
        data-widget-id={id}
        className={`card stat-tile home-summary-card home-widget home-widget-compact anim-rise${id !== "current-streak" ? " stat-tile-ring" : ""}`}
        style={{ ["--i" as string]: index }}
        onClick={() => setDetailsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={detailsOpen}
        aria-label={`View ${accessibleLabel} details`}
      >
        {cardContent}
        <span className="home-summary-card-affordance" aria-hidden="true">View details <ChevronRightIcon size={13} /></span>
      </button>
      {detailsOpen && sheet}
    </>
  );
}

export function HomeScreen({ onNavigate, onManageLocations }: { onNavigate?: (screen: Screen) => void; onManageLocations?: () => void } = {}) {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras, earningsHidden, workLocations } = useApp();
  const { active, last, startAtLocation, end } = useTodayShift();
  const [busy, setBusy] = useState(false);
  const [selectedClockLocationId, setSelectedClockLocationId] = useState("");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const { homeWidgetOrder, hiddenHomeWidgets } = useLayoutPreferences();
  const hiddenWidgets = useMemo(() => new Set(hiddenHomeWidgets), [hiddenHomeWidgets]);
  const visibleWidgets = useMemo(
    () => homeWidgetOrder.filter((widgetId) => !hiddenWidgets.has(widgetId)),
    [homeWidgetOrder, hiddenWidgets]
  );
  const dashboardRef = useFlipAnimation<HTMLDivElement>(visibleWidgets.join("|"));

  // Every hook below must run on every render regardless of loading state —
  // React requires the same hooks in the same order every time, so the
  // "not ready yet" bail-out has to come AFTER all of them, using safe
  // fallbacks for anything that reads `user` before it's confirmed non-null.
  const rate = user?.rate ?? 0;
  const weekStartsOn = user?.weekStartsOn ?? "Monday";
  const goalHours = user?.goalHours ?? 0;
  const goalEarnings = user?.goalEarnings ?? 0;
  const createdAt = user?.createdAt ?? today.toISOString();

  const weekDays = buildWeekDays(today, weekStartsOn);
  const weekStartISO = isoDate(weekDays[0]);
  const monthStartISO = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthEndISO = isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const {
    data: spendingSnapshot,
    loading: spendingSnapshotLoading,
    error: spendingSnapshotError,
    refresh: refreshSpendingSnapshot,
  } = useSpendingSummary(user?.id ?? "logged-out", monthStartISO, monthEndISO, !!user);
  const shiftsByDate = groupByDate(shifts);
  const expensesByDate = groupExpensesByDate(dayExpenses);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, CURRENCY, rate, expensesByDate);
  const { hours: savedHours, earnings: weekEarnings } = weekTotals(days, rate);
  const otherAmount = weekExtraFor(weekStartISO, weekExtras)?.amount ?? 0;
  const savedEarnings = weekEarnings + otherAmount;

  // While a shift is open (signed in, not yet signed out) its hours aren't in
  // `shifts` yet — add the live elapsed time on top so the week's totals visibly
  // climb in real time instead of jumping only once the shift is signed out.
  // Resets with the week itself since `days`/`weekDays` are already scoped to
  // the user's weekStartsOn setting.
  //
  // Gated on the open shift's *own* date actually being in this week: an
  // overnight shift that started the night before a week boundary belongs
  // entirely to the previous week once it's saved (see isDateInWeek), so
  // counting its live hours here too would show them in the new week first
  // and then have the total visibly jump backward the moment it's signed
  // out and the real, previous-week-dated total takes over.
  const activeShiftInThisWeek = !!last && isDateInWeek(last.date, weekDays);
  const activeShiftDate = last?.date ?? null;
  const activeShiftInMonth = !!activeShiftDate && activeShiftDate >= monthStartISO && activeShiftDate <= monthEndISO;

  const history = buildWeeklyHistory(shifts, today, weekStartsOn, rate, 7, new Date(createdAt), dayExpenses, weekExtras);

  const todayDay = days.find((d) => d.isToday);
  const activeWorkLocations = (workLocations ?? []).filter((location) => !location.archived);
  const previousWeekDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const rememberedLocationId = shifts.find((shift) => shift.date === isoDate(previousWeekDate))?.workLocationId ?? "";
  const defaultClockLocationId = activeWorkLocations.length === 1
    ? activeWorkLocations[0].id
    : activeWorkLocations.some((location) => location.id === rememberedLocationId)
      ? rememberedLocationId
      : "";
  const clockLocationId = selectedClockLocationId || defaultClockLocationId;
  const clockLocation = activeWorkLocations.find((location) => location.id === clockLocationId) ?? null;

  if (!user) return null;
  // Wait for the first shifts fetch before showing any totals — otherwise this
  // briefly renders $0 from the empty initial `shifts` array and then jumps to
  // the real number the instant the fetch resolves, which reads as a flicker.
  if (!shiftsLoaded || !todayDay) {
    return (
      <div className="screen-wide">
        <h1 className="section-title">This week</h1>
        <div className="home-top-grid">
          <Skeleton className="skeleton-card" />
          <Skeleton className="skeleton-card" />
        </div>
        <div className="stat-grid">
          <Skeleton className="skeleton-tile" />
          <Skeleton className="skeleton-tile" />
        </div>
      </div>
    );
  }

  async function handlePress() {
    setBusy(true);
    try {
      if (active) await end();
      else if (clockLocationId) await startAtLocation(clockLocationId);
      else setLocationPickerOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const todayHasExtra = todayDay.hours > 0 || todayDay.fuelCost > 0;
  const headline = active ? "Shift in progress" : todayHasExtra ? "Today logged" : "Today not logged yet";
  const subline = active
    ? `Started at ${formatTime12(last?.signIn)} — tap to end shift.`
    : todayHasExtra
      ? (
          <>
            {fmt2(todayDay.hours)}h · <Amount>{CURRENCY}{fmt2(todayDay.hours * user.rate + todayDay.fuelCost)}</Amount>
          </>
        )
      : "Tap to start your shift.";
  const spendingMonthLabel = today.toLocaleDateString("en-AU", { month: "long" });

  const renderWidget = (widgetId: HomeWidgetId, index: number) => {
    const animationStyle = { ["--i" as string]: index };
    if (widgetId === "week-summary") {
      return (
        <div key={widgetId} data-flip-key={widgetId} data-widget-id={widgetId} className="home-widget home-widget-medium anim-rise" style={animationStyle}>
          <LiveWeekSummaryCard
            active={active}
            signIn={last?.signIn ?? null}
            activeShiftInThisWeek={activeShiftInThisWeek}
            savedHours={savedHours}
            savedEarnings={savedEarnings}
            rate={rate}
            goalHours={goalHours}
            today={today}
            weekStartsOn={weekStartsOn}
            shifts={shifts}
            dayExpenses={dayExpenses}
            weekExtras={weekExtras}
            earningsHidden={earningsHidden}
          />
        </div>
      );
    }

    if (widgetId === "today-shift") {
      return (
        <div key={widgetId} data-flip-key={widgetId} data-widget-id={widgetId} className="home-widget home-widget-medium anim-rise" style={animationStyle}>
          <div className="card elev-sm">
            <div className="today-card-row">
              <div>
                <div className="card-title today-headline">{headline}</div>
                <p className="card-body today-subline">{subline}</p>
                <ElapsedTimer active={active} signIn={last?.signIn ?? null} />
                {!active && (
                  <div className="home-clock-location">
                    <span className="home-clock-location-label">Work location</span>
                    <WorkLocationTrigger
                      id="home-clock-location"
                      label="Work location"
                      location={clockLocation}
                      emptyLabel={activeWorkLocations.length ? "Choose a location" : "Add a work location"}
                      expanded={locationPickerOpen}
                      onClick={() => setLocationPickerOpen(true)}
                    />
                    {activeWorkLocations.length === 0 && <span className="field-hint">Add a work location before starting your shift.</span>}
                  </div>
                )}
              </div>
              <ShiftButton active={active} onStart={handlePress} onEnd={handlePress} busy={busy} />
            </div>
          </div>
        </div>
      );
    }

    if (widgetId === "spending") {
      return (
        <div key={widgetId} data-flip-key={widgetId} data-widget-id={widgetId} className="home-widget home-widget-wide anim-rise" style={animationStyle}>
          <HomeSpendingSnapshotCard
            monthLabel={spendingMonthLabel}
            snapshot={spendingSnapshot}
            loading={spendingSnapshotLoading}
            error={spendingSnapshotError}
            refresh={refreshSpendingSnapshot}
            onNavigate={onNavigate}
            active={active}
            signIn={last?.signIn ?? null}
            activeShiftInMonth={activeShiftInMonth}
            rate={rate}
          />
        </div>
      );
    }

    if (widgetId === "week-glance") {
      return (
        <section key={widgetId} data-flip-key={widgetId} data-widget-id={widgetId} className="home-widget home-widget-wide home-widget-glance anim-rise" style={animationStyle}>
          <h2 className="section-title home-glance-title">Week at a glance</h2>
          <div className="section-hint">How this week's hours are spread out, day by day.</div>
          <WeekGlanceCard
            days={days}
            earningsHidden={earningsHidden}
            active={active}
            signIn={last?.signIn ?? null}
            activeShiftInThisWeek={activeShiftInThisWeek}
            activeShiftDate={activeShiftDate}
            rate={rate}
          />
        </section>
      );
    }

    return <HomeStatWidget key={widgetId} id={widgetId} index={index} />;
  };

  return (
    <div className="screen-wide">
      <h1 className="section-title">This week</h1>

      <HomeStatsProvider
        days={days}
        shifts={shifts}
        history={history}
        goalEarnings={goalEarnings}
        today={today}
        rate={rate}
        active={active}
        signIn={last?.signIn ?? null}
        activeShiftInThisWeek={activeShiftInThisWeek}
        activeShiftDate={activeShiftDate}
        earningsHidden={earningsHidden}
      >
        {visibleWidgets.length > 0 ? (
          <div ref={dashboardRef} className="home-widget-grid">
            {visibleWidgets.map(renderWidget)}
          </div>
        ) : (
          <div className="card home-dashboard-empty">
            <div>
              <span className="home-dashboard-empty-icon" aria-hidden="true"><SlidersIcon size={22} /></span>
              <h2>Your dashboard is ready for you</h2>
              <p>Add back only the widgets you want from Settings → Profile & preferences.</p>
              <button type="button" className="btn btn-primary" onClick={() => onNavigate?.("settings")}>Open layout settings</button>
            </div>
          </div>
        )}
      </HomeStatsProvider>

      {locationPickerOpen && (
        <WorkLocationPicker
          title="Choose today's work location"
          locations={activeWorkLocations}
          selectedId={clockLocationId || null}
          onSelect={(locationId) => {
            setSelectedClockLocationId(locationId);
            return true;
          }}
          onManageLocations={() => {
            setLocationPickerOpen(false);
            if (onManageLocations) onManageLocations();
            else onNavigate?.("settings");
          }}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}
    </div>
  );
}
