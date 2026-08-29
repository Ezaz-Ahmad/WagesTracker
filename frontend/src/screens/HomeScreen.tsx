import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
import { buildWeekDays, fmt2, formatTime12, isoDate } from "../lib/date";
import { compareWeekEarnings } from "../lib/weekComparison";
import { useTodayShift } from "../lib/useTodayShift";
import { useCountUp } from "../lib/useCountUp";
import { useLiveElapsedHours } from "../lib/useLiveElapsedHours";
import { ElapsedTimer, ShiftButton } from "../components/ShiftButton";
import { GoalRing } from "../components/GoalRing";
import { FlameIcon, SpendingIcon, TrophyIcon } from "../components/icons";
import { Skeleton } from "../components/Skeleton";
import { Amount } from "../components/Amount";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";
import { ChartDataTable } from "../components/ChartDataTable";
import { LiveDataBadge } from "../components/LiveDataBadge";
import { useSpendingSummary } from "../lib/spendingDataCache";
import { withLiveDay, withLiveSpendingEarnings } from "../lib/liveShiftVisuals";
import type { DayExpense, Screen, Shift, SpendingSummary, WeekExtra, WeekStart } from "../lib/types";

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
    <div className="card elev-sm anim-rise" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 0 }}>
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
  const selectedIndex = glanceDays.findIndex((day) => day.dateISO === selectedDay?.dateISO);
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
    setSelectedDate(glanceDays[nextIndex].dateISO);
    barRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="card elev-sm anim-rise glance-card" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 2 }}>
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
              aria-expanded={selectedDate === day.dateISO}
              aria-controls={selectedDate ? "week-glance-day-details" : undefined}
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
      {selectedDay && (
        <section
          key={selectedDay.dateISO}
          id="week-glance-day-details"
          className="glance-day-details"
          aria-label={`Details for ${selectedDay.dayAbbr} ${selectedDay.dateLabel}`}
          style={{ ["--selected-index" as string]: Math.max(0, selectedIndex) }}
        >
          <div className="glance-day-details-heading">
            <div><strong>{selectedDay.dayAbbr}</strong><span>{selectedDay.dateLabel}</span></div>
            <div className="glance-day-details-actions">
              {selectedIsActive && <span className="glance-active-shift"><span aria-hidden="true" />Live now</span>}
              <button type="button" className="glance-day-details-close" onClick={() => setSelectedDate(null)} aria-label="Hide day details">Hide</button>
            </div>
          </div>
          <dl className="glance-day-detail-grid">
            <div><dt>Hours</dt><dd className="live-number-slot">{selectedDay.displayHours > 0 ? `${fmt2(selectedDay.displayHours)}h` : "—"}</dd></div>
            {!props.earningsHidden && <div><dt>Earnings</dt><dd className="live-number-slot" aria-live={selectedIsActive ? "polite" : undefined} aria-atomic={selectedIsActive ? "true" : undefined}>{selectedDay.moneyLabel}</dd></div>}
            <div><dt>Shifts</dt><dd>{recordedShifts.length || "—"}</dd></div>
            <div><dt>Fuel</dt><dd>{selectedDay.fuelCostLabel}</dd></div>
          </dl>
          <p className="glance-day-branches"><span>{branches.length === 1 ? "Branch" : "Branches"}</span>{branches.length ? branches.join(" · ") : "No branch recorded"}</p>
        </section>
      )}
      <ChartDataTable
        caption="Hours worked each day this week"
        labelHeading="Day"
        valueHeading="Hours"
        rows={glanceDays.map((day) => ({ label: `${day.dayAbbr} ${day.dateLabel}`, value: day.displayHours > 0 ? `${fmt2(day.displayHours)}h` : "No entry" }))}
      />
    </div>
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
    <section className="card elev-sm home-spending-snapshot anim-rise" aria-labelledby="home-spending-title" aria-busy={props.loading || undefined} style={{ ["--i" as string]: 2 }}>
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

function LiveHomeStats(props: {
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
    <div className="stat-grid">
      <div className="card stat-tile stat-tile-ring anim-rise" style={{ ["--i" as string]: 3 }}>
        <div className="card-kicker">Days logged</div>
        <div className="stat-tile-ring-row">
          <GoalRing pct={daysLoggedPct} value={`${daysLoggedAnim}/7`} live={ticking} />
          <div className="card-meta stat-tile-ring-caption">days worked</div>
        </div>
      </div>
      <div className="card stat-tile stat-tile-ring anim-rise" style={{ ["--i" as string]: 4 }}>
        <div className="card-kicker">Weeks on goal</div>
        <div className="stat-tile-ring-row">
          <GoalRing pct={weeksOnGoalPct} value={`${metGoalAnim}/${props.history.length}`} />
          <div className="card-meta stat-tile-ring-caption">on goal</div>
        </div>
      </div>
      <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 5 }}>
        <div className="card-kicker">Current streak</div>
        <div className="card-title stat-tile-value stat-tile-icon-row">
          <FlameIcon size={19} />
          <span className="count-value">{streakAnim}</span>
        </div>
        <div className="card-meta">{streak === 1 ? "day in a row" : "days in a row"}</div>
      </div>
      <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 6 }}>
        <div className="card-kicker">Best day this week</div>
        <div className="card-title stat-tile-value stat-tile-icon-row">
          <TrophyIcon size={19} />
          <span>{bestDay ? bestDay.dayAbbr : "—"}</span>
        </div>
        <div className="card-meta live-metric-value">{bestDay ? <Amount>{bestDay.moneyLabel}</Amount> : "Log a shift to see it"}</div>
      </div>
    </div>
  );
}

export function HomeScreen({ onNavigate }: { onNavigate?: (screen: Screen) => void } = {}) {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras, earningsHidden, workLocations } = useApp();
  const { active, last, startAtLocation, end } = useTodayShift();
  const [busy, setBusy] = useState(false);
  const [selectedClockLocationId, setSelectedClockLocationId] = useState("");

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
      else onNavigate?.(activeWorkLocations.length === 0 ? "settings" : "entry");
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

  return (
    <div className="screen-wide">
      <h1 className="section-title">This week</h1>
      <div className="home-top-grid">
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

        <div className="card elev-sm anim-rise" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 1 }}>
          <div className="today-card-row">
            <div>
              <div className="card-title today-headline">{headline}</div>
              <p className="card-body today-subline">{subline}</p>
              <ElapsedTimer active={active} signIn={last?.signIn ?? null} />
              {!active && activeWorkLocations.length > 0 && (
                <label className="home-clock-location">
                  <span>Work location</span>
                  <select className="input" value={clockLocationId} onChange={(event) => setSelectedClockLocationId(event.target.value)}>
                    {activeWorkLocations.length > 1 && <option value="">Choose a location</option>}
                    {activeWorkLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                </label>
              )}
              {!active && activeWorkLocations.length === 0 && <p className="field-hint">Add a work location in Settings before starting.</p>}
            </div>
            <ShiftButton active={active} onStart={handlePress} onEnd={handlePress} busy={busy} />
          </div>
        </div>
      </div>

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

      <LiveHomeStats
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
      />
    </div>
  );
}
