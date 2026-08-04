import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { buildWeekDaysComputed, buildWeeklyHistory, groupByDate, weekTotals } from "../lib/aggregate";
import { buildWeekDays, fmt2 } from "../lib/date";
import { useTodayShift } from "../lib/useTodayShift";
import { ElapsedTimer, ShiftButton } from "../components/ShiftButton";

export function HomeScreen() {
  const { today, user, shifts } = useApp();
  const { active, last, start, end } = useTodayShift();
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const weekDays = buildWeekDays(today, user.weekStartsOn);
  const shiftsByDate = groupByDate(shifts);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, CURRENCY, user.rate);
  const { hours: totalHours, earnings: totalEarnings, daysLogged } = weekTotals(days, user.rate);

  const history = buildWeeklyHistory(shifts, today, user.weekStartsOn, user.rate, 7);
  const lastWeek = history[history.length - 1];
  const prevWeek = history[history.length - 2];
  const trendPct = prevWeek && prevWeek.earnings > 0 ? Math.round(((lastWeek.earnings - prevWeek.earnings) / prevWeek.earnings) * 100) : 0;
  const trendUp = trendPct >= 0;
  const metGoalCount = history.filter((w) => w.earnings >= user.goalEarnings).length;

  const progressPct = user.goalHours > 0 ? Math.min(100, Math.round((totalHours / user.goalHours) * 100)) : 0;
  const todayDay = days.find((d) => d.isToday)!;

  async function handlePress() {
    setBusy(true);
    try {
      if (active) await end();
      else await start();
    } finally {
      setBusy(false);
    }
  }

  const headline = active ? "Shift in progress" : todayDay.hours > 0 ? "Today logged" : "Today not logged yet";
  const subline = active
    ? `Started at ${last?.signIn} — tap to end shift.`
    : todayDay.hours > 0
      ? `${todayDay.hours}h · ${CURRENCY}${fmt2(todayDay.hours * user.rate)}`
      : "Tap to start your shift.";

  return (
    <>
      <h6 className="section-title">This week</h6>
      <div className="card elev-sm" style={{ marginBottom: "var(--space-4)" }}>
        <div className="week-card-top">
          <div className="week-amount">{CURRENCY}{fmt2(totalEarnings)}</div>
          <div className="week-trend" style={{ color: trendUp ? "var(--color-accent-700)" : "var(--color-text)" }}>
            {trendUp ? "▲ " : "▼ "}
            {Math.abs(trendPct)}% vs prior week
          </div>
        </div>
        <div className="card-meta" style={{ marginTop: 2 }}>
          {totalHours}h logged · goal {user.goalHours}h
        </div>
        <div className="hr" style={{ margin: "var(--space-3) 0" }} />
        <div className="progress-label-row">
          <span>Hours toward goal</span>
          <span>{progressPct}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: "var(--space-4)" }}>
        <div className="today-card-row">
          <div>
            <div className="card-title today-headline">{headline}</div>
            <p className="card-body today-subline">{subline}</p>
            <ElapsedTimer active={active} signIn={last?.signIn ?? null} />
          </div>
          <ShiftButton active={active} onStart={handlePress} onEnd={handlePress} busy={busy} />
        </div>
      </div>

      <div className="stat-grid">
        <div className="card stat-tile">
          <div className="card-kicker">Days logged</div>
          <div className="card-title stat-tile-value">{daysLogged} / 7</div>
        </div>
        <div className="card stat-tile">
          <div className="card-kicker">Weeks on goal</div>
          <div className="card-title stat-tile-value-lg">{metGoalCount} / {history.length}</div>
        </div>
      </div>
    </>
  );
}
