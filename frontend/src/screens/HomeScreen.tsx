import { useEffect, useRef, useState } from "react";
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
import * as api from "../lib/api";
import type { Screen, SpendingSummary } from "../lib/types";

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

export function HomeScreen({ onNavigate }: { onNavigate?: (screen: Screen) => void } = {}) {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras, earningsHidden } = useApp();
  const { active, last, start, end } = useTodayShift();
  const [busy, setBusy] = useState(false);
  const [spendingSnapshot, setSpendingSnapshot] = useState<SpendingSummary | null>(null);
  const [spendingSnapshotLoading, setSpendingSnapshotLoading] = useState(true);
  const spendingRequestRef = useRef(0);

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
  const liveHours = useLiveElapsedHours(active, last?.signIn ?? null);
  const activeShiftInThisWeek = !!last && isDateInWeek(last.date, weekDays);
  const effectiveLiveHours = activeShiftInThisWeek ? liveHours : 0;
  const totalHours = savedHours + effectiveLiveHours;
  const totalEarnings = savedEarnings + effectiveLiveHours * rate;

  const history = buildWeeklyHistory(shifts, today, weekStartsOn, rate, 7, new Date(createdAt), dayExpenses, weekExtras);
  const metGoalCount = history.filter((w) => w.earnings >= goalEarnings).length;

  // Derived here, in render, from the same context state the headline uses —
  // so it re-computes on every change that can move it (a shift saved or
  // deleted, sign-in/out, fuel or other-earnings edits, a rate change, the
  // week-start preference, a manual refresh, and the day/week rollover that
  // `today` picks up from AppContext's minute timer) without needing a single
  // explicit subscription. The live shift's earnings are passed in so the
  // comparison counts exactly what the headline above it counts.
  const weekComparison = compareWeekEarnings({
    today,
    weekStartsOn,
    shifts,
    dayExpenses,
    weekExtras,
    rate,
    liveEarnings: effectiveLiveHours * rate,
  });

  // Clamped *and* guarded against a non-finite result. A malformed shift
  // from the server makes totalHours NaN, which used to surface as a
  // harmless `width: NaN%` the browser ignored — but the same value now
  // feeds aria-valuenow, where NaN is an outright invalid ARIA value (axe:
  // aria-valid-attr-value) rather than something quietly dropped. Falling
  // back to 0 shows an empty bar, which is the honest reading of "we can't
  // compute your progress".
  const rawProgressPct = goalHours > 0 ? Math.round((totalHours / goalHours) * 100) : 0;
  const progressPct = Number.isFinite(rawProgressPct) ? Math.max(0, Math.min(100, rawProgressPct)) : 0;
  const todayDay = days.find((d) => d.isToday);

  // While a shift is active, show the exact live number every tick rather than
  // easing toward it — the eased animation is great for one-off jumps (like a
  // settled total after signing out) but reads as "stuck"/not-live when it's
  // chasing a target that moves every second.
  const earningsSmoothed = useCountUp(totalEarnings, 650);
  const earningsAnim = active ? totalEarnings : earningsSmoothed;
  const progressPctSmoothed = Math.round(useCountUp(progressPct, 550));
  const progressPctAnim = active ? progressPct : progressPctSmoothed;
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

  // Week-at-a-glance bar heights, scaled to the tallest day. The open
  // shift's live hours go on the bar for the date it actually *started* on
  // (last?.date) rather than always on "today"'s bar — the two differ
  // exactly when a shift is still running after midnight, and attributing
  // it to today's bar would show it in the wrong place (and, across a week
  // boundary, potentially not on this screen's week at all — see
  // activeShiftInThisWeek above) compared to where it lands once saved.
  const glanceDays = days.map((d) => ({
    ...d,
    displayHours: d.hours + (activeShiftInThisWeek && d.dateISO === last?.date ? liveHours : 0),
  }));
  const maxGlanceHours = Math.max(...glanceDays.map((d) => d.displayHours), 1);

  useEffect(() => {
    const requestId = ++spendingRequestRef.current;
    // Some isolated Home tests intentionally replace the older API surface
    // with a minimal mock. In the real application this function is always
    // present; the guard keeps those focused legacy fixtures from needing to
    // know about an optional snapshot they do not exercise.
    if (typeof api.getSpendingSummary !== "function") return;
    setSpendingSnapshotLoading(true);
    void api.getSpendingSummary(monthStartISO, monthEndISO)
      .then((result) => {
        if (requestId === spendingRequestRef.current) setSpendingSnapshot(result);
      })
      .catch(() => { /* Snapshot is optional; the full Spending screen owns retry UI. */ })
      .finally(() => {
        if (requestId === spendingRequestRef.current) setSpendingSnapshotLoading(false);
      });
  }, [monthStartISO, monthEndISO, shifts, dayExpenses, weekExtras, rate]);

  if (!user) return null;
  // Wait for the first shifts fetch before showing any totals — otherwise this
  // briefly renders $0 from the empty initial `shifts` array and then jumps to
  // the real number the instant the fetch resolves, which reads as a flicker.
  if (!shiftsLoaded || !todayDay) {
    return (
      <div className="screen-wide screen-transition">
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

  return (
    <div className="screen-wide">
      <h1 className="section-title">This week</h1>
      <div className="home-top-grid">
        <div className="card elev-sm anim-rise" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 0 }}>
          <div className="week-card-top">
            <div className="week-amount count-value">
              <Amount>{CURRENCY}{fmt2(earningsAnim)}</Amount>
            </div>
            {/* Hidden entirely while earnings are masked: a percentage change
                is financial information too, and blurring the dollar amount
                while announcing "up 20%" would defeat the point. */}
            {earningsHidden ? (
              <div className="week-trend is-muted">Earnings hidden</div>
            ) : (
              <div
                className={`week-trend is-${weekComparison.direction}`}
                title={weekComparison.isEstimate ? "Includes the shift currently in progress" : undefined}
              >
                {weekComparison.direction === "up" ? "▲ " : weekComparison.direction === "down" ? "▼ " : ""}
                {weekComparison.label}
                {weekComparison.isEstimate && weekComparison.direction !== "none" ? " (est.)" : ""}
              </div>
            )}
          </div>
          <EarningsHiddenHint />
          <div className="card-meta" style={{ marginTop: 2 }}>
            {fmt2(totalHours)}h logged · goal {user.goalHours}h
          </div>
          <div className="hr" style={{ margin: "var(--space-3) 0" }} />
          <div className="progress-label-row" id="home-goal-progress-label">
            <span>Hours toward goal</span>
            <span className="count-value">{progressPctAnim}%</span>
          </div>
          {/* Was a pair of anonymous divs. The percentage beside the label
              happens to be readable, but nothing connected it to the bar or
              told assistive tech this was a progress indicator at all.
              aria-valuenow uses the settled figure, not the count-up
              animation value, so it never announces an intermediate frame. */}
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-labelledby="home-goal-progress-label"
          >
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

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
          {spendingSnapshotLoading && spendingSnapshot && <span className="home-spending-updating">Updating…</span>}
        </div>
        {spendingSnapshot ? (
          <div className="home-spending-content">
            <p className="visually-hidden">Personal spending for {spendingMonthLabel}: {CURRENCY}{fmt2(spendingSnapshot.totalSpendingCents / 100)}. {snapshotCategories.map((category) => `${category.name} ${((category.totalCents / Math.max(1, spendingSnapshot.totalSpendingCents)) * 100).toFixed(1)} percent`).join(", ")}.</p>
            <div className="home-spending-chart-row">
              <div className="home-spending-donut" aria-hidden="true" style={{ background: donutBackground(spendingSnapshot) }}>
                <strong>{CURRENCY}{Math.round(spendingSnapshot.totalSpendingCents / 100).toLocaleString("en-AU")}</strong><span>spent</span>
              </div>
              <ul className="home-spending-legend" aria-label={`${spendingMonthLabel} spending by category`}>
                {snapshotCategories.length ? snapshotCategories.map((category) => (
                  <li key={category.id}><span style={{ backgroundColor: category.colour }} aria-hidden="true" /><span>{category.name}</span><strong>{((category.totalCents / spendingSnapshot.totalSpendingCents) * 100).toFixed(0)}%</strong></li>
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
        ) : spendingSnapshotLoading ? <div className="home-spending-loading"><span className="spinner" /> Loading this month's spending…</div> : <div className="card-meta">Open Spending to record and review personal expenses.</div>}
      </section>

      <h2 className="section-title home-glance-title">Week at a glance</h2>
      <div className="section-hint">How this week's hours are spread out, day by day.</div>
      <div className="card elev-sm anim-rise glance-card" style={{ marginBottom: "var(--space-4)", ["--i" as string]: 2 }}>
        {/* The bars carried their information in `title` attributes on
            <div>s — a tooltip, which is unreachable by touch, unreliable
            for screen readers, and never shown on keyboard focus. The
            drawing is hidden from assistive tech and the same day-by-day
            figures are published as a table below it. */}
        <div className="glance-bars" aria-hidden="true">
          {glanceDays.map((d, i) => {
            const pct = Math.max(4, Math.round((d.displayHours / maxGlanceHours) * 100));
            const worked = d.displayHours > 0;
            return (
              <div
                key={d.dateISO}
                className={`glance-bar-col${d.isToday ? " is-today" : ""}`}
                style={{ ["--i" as string]: i }}
                title={`${d.dayAbbr} ${d.dateLabel} — ${
                  worked ? `${fmt2(d.displayHours)}h${earningsHidden ? "" : ` · ${d.moneyLabel}`}` : "No entry"
                }`}
              >
                <div className="glance-bar-track">
                  <div className={`glance-bar-fill${worked ? " is-worked" : ""}`} style={{ height: `${pct}%` }} />
                </div>
                <div className="glance-bar-label">{d.dayAbbr.charAt(0)}</div>
              </div>
            );
          })}
        </div>
        <ChartDataTable
          caption="Hours worked each day this week"
          labelHeading="Day"
          valueHeading="Hours"
          rows={glanceDays.map((d) => ({
            label: `${d.dayAbbr} ${d.dateLabel}`,
            value: d.displayHours > 0 ? `${fmt2(d.displayHours)}h` : "No entry",
          }))}
        />
      </div>

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
