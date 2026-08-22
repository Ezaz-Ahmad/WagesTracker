import { useState } from "react";
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
import { useSpendingSummary } from "../lib/spendingDataCache";
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
  const raw = goalHours > 0 ? Math.round((hours / goalHours) * 100) : 0;
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
  const displayProgress = ticking ? progressPct : progressSmoothed;
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
}) {
  const glanceDays = props.days.map((day) => ({
    ...day,
    displayHours: day.hours,
  }));
  const maxGlanceHours = Math.max(...glanceDays.map((day) => day.displayHours), 1);

  return (
    <div className="card elev-sm anim-rise glance-card" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 2 }}>
      <div className="glance-bars" aria-hidden="true">
        {glanceDays.map((day, index) => {
          const pct = Math.max(4, Math.round((day.displayHours / maxGlanceHours) * 100));
          const worked = day.displayHours > 0;
          return (
            <div
              key={day.dateISO}
              className={`glance-bar-col${day.isToday ? " is-today" : ""}`}
              style={{ ["--i" as string]: index }}
              title={`${day.dayAbbr} ${day.dateLabel} — ${worked ? `${fmt2(day.displayHours)}h${props.earningsHidden ? "" : ` · ${day.moneyLabel}`}` : "No entry"}`}
            >
              <div className="glance-bar-track"><div className={`glance-bar-fill${worked ? " is-worked" : ""}`} style={{ height: `${pct}%` }} /></div>
              <div className="glance-bar-label">{day.dayAbbr.charAt(0)}</div>
            </div>
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

export function HomeScreen({ onNavigate }: { onNavigate?: (screen: Screen) => void } = {}) {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras, earningsHidden } = useApp();
  const { active, last, start, end } = useTodayShift();
  const [busy, setBusy] = useState(false);

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
  const { hours: savedHours, earnings: weekEarnings, daysLogged } = weekTotals(days, rate);
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

  const history = buildWeeklyHistory(shifts, today, weekStartsOn, rate, 7, new Date(createdAt), dayExpenses, weekExtras);
  const metGoalCount = history.filter((w) => w.earnings >= goalEarnings).length;

  const todayDay = days.find((d) => d.isToday);
  const daysLoggedAnim = Math.round(useCountUp(daysLogged, 450));
  const metGoalAnim = Math.round(useCountUp(metGoalCount, 450));

  const streak = computeStreak(shiftsByDate, today);
  const streakAnim = Math.round(useCountUp(streak, 450));
  const daysLoggedPct = Math.round((daysLogged / 7) * 100);
  const weeksOnGoalPct = history.length > 0 ? Math.round((metGoalCount / history.length) * 100) : 0;

  // The day with the highest earnings this week (hours × rate + fuel cost),
  // ignoring days with nothing logged. Undefined until at least one shift or
  // fuel entry exists — the tile falls back to a prompt in that case.
  let bestDay: (typeof days)[number] | undefined;
  let bestDayEarnings = 0;
  for (const d of days) {
    const earnings = d.hours * rate + d.fuelCost;
    if (earnings > bestDayEarnings) {
      bestDayEarnings = earnings;
      bestDay = d;
    }
  }

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
      else await start();
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
  const snapshotCategories = spendingSnapshot ? homeSnapshotCategories(spendingSnapshot) : [];
  const donutAmount = spendingSnapshot ? formatHomeDonutAmount(spendingSnapshot.totalSpendingCents) : null;

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
            </div>
            <ShiftButton active={active} onStart={handlePress} onEnd={handlePress} busy={busy} />
          </div>
        </div>
      </div>

      <section className="card elev-sm home-spending-snapshot anim-rise" aria-labelledby="home-spending-title" aria-busy={spendingSnapshotLoading || undefined} style={{ ["--i" as string]: 2 }}>
        <div className="home-spending-heading">
          <div className="home-spending-title-row"><SpendingIcon size={18} /><div><span className="card-kicker">Monthly snapshot</span><h2 id="home-spending-title" className="card-title">Personal spending — {spendingMonthLabel}</h2></div></div>
          {spendingSnapshotError && spendingSnapshot ? (
            <button type="button" className="home-spending-refresh-state is-warning" onClick={() => void refreshSpendingSnapshot().catch(() => {})} title={spendingSnapshotError}>Retry refresh</button>
          ) : (
            <span className={`home-spending-updating${spendingSnapshotLoading && spendingSnapshot ? " is-visible" : ""}`} aria-live="polite">Updating…</span>
          )}
        </div>
        {spendingSnapshot ? (
          <div className="home-spending-content">
            <p className="visually-hidden">Personal spending for {spendingMonthLabel}: {CURRENCY}{fmt2(spendingSnapshot.totalSpendingCents / 100)}. {snapshotCategories.map((category) => `${category.name} ${((category.totalCents / Math.max(1, spendingSnapshot.totalSpendingCents)) * 100).toFixed(1)} percent`).join(", ")}.</p>
            <div className="home-spending-chart-row">
              <div className="home-spending-donut" aria-hidden="true" style={{ background: donutBackground(spendingSnapshot) }} title={donutAmount?.full}>
                <div className={`home-spending-donut-center is-${donutAmount?.fit}`}>
                  <strong>{donutAmount?.display}</strong><span>Spent this month</span>
                </div>
              </div>
              <ul className="home-spending-legend" aria-label={`${spendingMonthLabel} spending by category`}>
                {snapshotCategories.length ? snapshotCategories.map((category) => (
                  <li key={category.id}><span style={{ backgroundColor: category.colour }} aria-hidden="true" /><span>{category.name}</span><strong>{categoryPercentage(category.totalCents, spendingSnapshot.totalSpendingCents)}</strong></li>
                )) : <li className="home-spending-empty">No expenses recorded this month.</li>}
              </ul>
            </div>
            <div className="home-spending-values">
              <div><span>Recorded earnings</span><strong><Amount>{CURRENCY}{fmt2(spendingSnapshot.earningsCents / 100)}</Amount></strong></div>
              <div><span>Monthly spending</span><strong>{CURRENCY}{fmt2(spendingSnapshot.totalSpendingCents / 100)}</strong></div>
              <div><span>{spendingSnapshot.differenceCents < 0 ? "Over earnings" : "Remaining"}</span><strong><Amount>{spendingSnapshot.differenceCents < 0 ? "−" : ""}{CURRENCY}{fmt2(Math.abs(spendingSnapshot.differenceCents) / 100)}</Amount></strong></div>
            </div>
            <button type="button" className="btn btn-secondary home-spending-cta" onClick={() => onNavigate?.("spending")}>View full spending dashboard <span aria-hidden="true">→</span></button>
          </div>
        ) : spendingSnapshotLoading ? <HomeSpendingSkeleton /> : spendingSnapshotError ? (
          <div className="home-spending-error" role="alert"><span>{spendingSnapshotError}</span><button type="button" className="btn btn-secondary" onClick={() => void refreshSpendingSnapshot().catch(() => {})}>Retry</button></div>
        ) : <div className="card-meta">Open Spending to record and review personal expenses.</div>}
      </section>

      <h2 className="section-title home-glance-title">Week at a glance</h2>
      <div className="section-hint">How this week's hours are spread out, day by day.</div>
      <WeekGlanceCard
        days={days}
        earningsHidden={earningsHidden}
      />

      <div className="stat-grid">
        <div className="card stat-tile stat-tile-ring anim-rise" style={{ ["--i" as string]: 3 }}>
          <div className="card-kicker">Days logged</div>
          <div className="stat-tile-ring-row">
            <GoalRing pct={daysLoggedPct} value={`${daysLoggedAnim}/7`} />
            <div className="card-meta stat-tile-ring-caption">days worked</div>
          </div>
        </div>
        <div className="card stat-tile stat-tile-ring anim-rise" style={{ ["--i" as string]: 4 }}>
          <div className="card-kicker">Weeks on goal</div>
          <div className="stat-tile-ring-row">
            <GoalRing pct={weeksOnGoalPct} value={`${metGoalAnim}/${history.length}`} />
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
          <div className="card-meta">{bestDay ? <Amount>{bestDay.moneyLabel}</Amount> : "Log a shift to see it"}</div>
        </div>
      </div>
    </div>
  );
}
