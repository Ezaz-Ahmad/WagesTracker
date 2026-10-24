import { useEffect, useState } from "react";
import type { User } from "../lib/types";
import { isoDate, parseIsoDate, weekRangeLabel } from "../lib/date";
import { addIsoDays, startOfWeekISO } from "../lib/weekBoundary.mjs";
import { AdminApiError, fetchUserEarnings, type AdminUserEarnings as EarningsData } from "./adminApi";
import { AdminEarningsChart } from "./AdminEarningsChart";

export const adminMoney = (amount: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
export const adminWeekLabel = (start: string, end: string) => weekRangeLabel(parseIsoDate(start), parseIsoDate(end));

export function AdminUserEarnings({ user, initialDate, onAuthError }: {
  user: User;
  initialDate: string;
  onAuthError: (error: unknown) => boolean;
}) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<EarningsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const today = isoDate(new Date());
  const currentStart = startOfWeekISO(today, user.weekStartsOn);
  const selectedStart = startOfWeekISO(date, user.weekStartsOn);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    void fetchUserEarnings(user.id, date).then((result) => {
      if (active) setData(result);
    }).catch((reason: unknown) => {
      if (!active || onAuthError(reason)) return;
      setError(reason instanceof AdminApiError ? reason.message : "Couldn't load earnings. Please try again.");
    });
    return () => { active = false; };
  }, [user.id, date, retry, onAuthError]);

  const weeks = Array.from(new Set([currentStart, selectedStart, ...(data?.availableWeeks ?? [])])).sort().reverse();
  const week = data?.week;
  const previous = data?.previousWeek;
  const difference = week && previous ? Math.round((week.total - previous.total) * 100) / 100 : 0;
  const goalProgress = week && user.goalEarnings > 0 ? Math.max(0, Math.min(100, week.total / user.goalEarnings * 100)) : 0;

  return <section className="admin-user-earnings" aria-label={`${user.name} weekly earnings`}>
    <div className="admin-earnings-heading">
      <div><p className="admin-eyebrow">Earnings explorer</p><h3>{selectedStart === currentStart ? "This week's earnings" : "Weekly earnings"}</h3></div>
      <button className="btn btn-ghost" onClick={() => setDate(today)} disabled={selectedStart === currentStart}>This week</button>
    </div>
    <div className="admin-week-navigator">
      <button className="admin-week-arrow" aria-label="Previous earnings week" onClick={() => setDate(addIsoDays(selectedStart, -7))}>←</button>
      <div className="admin-week-select">
        <label htmlFor="admin-earnings-week">Select a week</label>
        <select id="admin-earnings-week" className="input" value={selectedStart} onChange={(event) => setDate(event.target.value)}>
          {weeks.map((start) => <option key={start} value={start}>{start === currentStart ? "This week · " : ""}{adminWeekLabel(start, addIsoDays(start, 6))}</option>)}
        </select>
      </div>
      <button className="admin-week-arrow" aria-label="Next earnings week" disabled={selectedStart >= currentStart} onClick={() => setDate(addIsoDays(selectedStart, 7))}>→</button>
    </div>
    <p className="admin-context-note">{user.weekStartsOn} start · Use the arrows to explore any earlier week.</p>

    {error ? <div className="admin-inline-error" role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => setRetry((value) => value + 1)}>Retry earnings</button></div>
      : !week || !previous ? <div className="admin-earnings-loading" role="status"><div className="admin-skeleton" /><p>Loading weekly earnings…</p></div>
      : <div className="admin-earnings-content" key={week.weekStart}>
        <div className="admin-earnings-hero">
          <div><span className="admin-metric-label">Total earned · AUD</span><strong className="admin-earned-total">{adminMoney(week.total)}</strong>
            <span className={`admin-comparison${difference > 0 ? " is-up" : difference < 0 ? " is-down" : ""}`}>{difference === 0 ? "No change" : `${difference > 0 ? "+" : "−"}${adminMoney(Math.abs(difference))}`} vs previous week</span>
          </div>
          <div className="admin-earnings-hero-meta"><strong>{week.hours.toFixed(2)}<small> hours</small></strong><span>{week.completedShiftCount} completed {week.completedShiftCount === 1 ? "shift" : "shifts"}</span>
            {week.openShiftCount > 0 && <span className="admin-open-shift">{week.openShiftCount} unfinished · wages pending</span>}
          </div>
        </div>
        <dl className="admin-pay-breakdown">
          <div><dt>Shift wages</dt><dd>{adminMoney(week.wages)}</dd></div>
          <div><dt>Fuel allowance</dt><dd>{adminMoney(week.fuel)}</dd></div>
          <div><dt>Weekly extras</dt><dd>{adminMoney(week.extras)}</dd></div>
          <div><dt>Previous week</dt><dd>{adminMoney(previous.total)}</dd></div>
        </dl>
        {user.goalEarnings > 0 && <div className="admin-goal-progress">
          <div><span>Weekly earnings goal</span><strong>{Math.round(goalProgress)}% of {adminMoney(user.goalEarnings)}</strong></div>
          <div role="progressbar" aria-label="Weekly earnings goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goalProgress)} aria-valuetext={`${adminMoney(week.total)} of ${adminMoney(user.goalEarnings)}`}><span style={{ width: `${goalProgress}%` }} /></div>
        </div>}
        <AdminEarningsChart days={week.days} previousDays={previous.days} label="Daily earnings" />
        <p className="admin-context-note">Daily bars include wages and fuel. Weekly extras are added separately to the total. Daily rounding can differ from the weekly total by a cent.</p>
        {selectedStart === currentStart && <p className="admin-context-note">This week is still in progress; the comparison uses the full previous week.</p>}
        <p className="admin-calculation-note">Completed shifts × current rate of {adminMoney(user.rate)}/hr, plus fuel and extras. Unfinished shifts add no wages. Historical amounts use the current rate.</p>
      </div>}
  </section>;
}
