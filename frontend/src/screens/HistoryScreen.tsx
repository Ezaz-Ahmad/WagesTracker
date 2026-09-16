import { useCallback, useState } from "react";
import { useApp } from "../context/AppContext";
import { buildWeeklyHistory } from "../lib/aggregate";
import { Skeleton } from "../components/Skeleton";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";
import { WeekCard } from "../history/WeekCard";
import { DayEditorSheet, type DayEditorTarget } from "../history/DayEditorSheet";
import { EmptyState } from "../components/EmptyState";
import { CalendarIcon, HistoryIcon } from "../components/icons";
import { startOfWeek } from "../lib/date";
import type { WeekStart } from "../lib/types";
import { HistoryDateRangePicker } from "../history/HistoryDateRangePicker";
import {
  currentMonthRange,
  formatHistoryDateRange,
  weekOverlapsRange,
  type HistoryDateRange,
} from "../history/historyDateRange";

function completedWeekCountSince(signupDate: Date, today: Date, weekStartsOn: WeekStart): number {
  const currentStart = startOfWeek(today, weekStartsOn);
  const signupStart = startOfWeek(signupDate, weekStartsOn);
  const asUtcDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.round((asUtcDay(currentStart) - asUtcDay(signupStart)) / (7 * 24 * 60 * 60 * 1000)));
}

/**
 * Completed weeks, most recent first.
 *
 * This used to be a four-column table of totals with nothing to click. It is
 * now a list of week cards that each expand to the week's days, offer a PDF
 * for that specific week, and let a day's hours be corrected — which is the
 * whole feature.
 *
 * Every figure still comes from `buildWeeklyHistory` and
 * `buildWeekDaysComputed`; no total is computed on this screen. That matters
 * beyond tidiness: after an edit, History, Home's prior-week comparison, the
 * Report charts and a freshly generated PDF all recompute from the same
 * `shifts` array in context, so they cannot disagree with each other.
 */
export function HistoryScreen() {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras, createShiftOrThrow, updateShiftOrThrow, removeShiftOrThrow, setFuelCostOrThrow } =
    useApp();
  const [editing, setEditing] = useState<DayEditorTarget | null>(null);
  const [dateRange, setDateRange] = useState<HistoryDateRange>(() => currentMonthRange(today));

  // Saving routes through AppContext, which replaces the shift in the one
  // canonical array every screen derives from. There is deliberately no
  // separate History cache to invalidate — the recalculation happens because
  // there is only one source, not because something remembered to refresh.
  const handleSave = useCallback(
    async (shiftId: string | null, values: { signIn: string; signOut: string; location: string; workLocationId: string | null; locationChanged: boolean; fuelCost: number | null; shiftChanged: boolean; fuelChanged: boolean; allowFutureDate: boolean }) => {
      if (!editing) return;
      // The throwing variants: the editor shows the failure next to the
      // values that caused it. The swallowing versions would route it to the
      // global banner behind the modal, where it would be invisible — the
      // same mistake the sessions drawer made before PR 3 fixed it.
      if (values.shiftChanged) {
        const shiftValues = {
          signIn: values.signIn,
          signOut: values.signOut,
          ...(values.locationChanged || !shiftId
            ? { location: values.location, workLocationId: values.workLocationId }
            : {}),
          ...(values.allowFutureDate ? { allowFutureDate: true } : {}),
        };
        if (shiftId) await updateShiftOrThrow(shiftId, shiftValues);
        else await createShiftOrThrow({ date: editing.dateISO, ...shiftValues });
      }
      if (values.fuelChanged) await setFuelCostOrThrow(editing.dateISO, values.fuelCost, values.allowFutureDate);
    },
    [editing, updateShiftOrThrow, createShiftOrThrow, setFuelCostOrThrow]
  );

  const handleDelete = useCallback(
    async (shiftId: string) => {
      await removeShiftOrThrow(shiftId);
    },
    [removeShiftOrThrow]
  );

  if (!user) return null;
  if (!shiftsLoaded) {
    return (
      <div className="screen-narrow">
        <div className="history-page-heading">
          <div>
            <h1 className="section-title">History</h1>
            <div className="section-hint">Completed weekly reports, most recent first.</div>
          </div>
        </div>
        <Skeleton className="skeleton-week-card" />
        <Skeleton className="skeleton-week-card" />
        <Skeleton className="skeleton-week-card" />
      </div>
    );
  }

  const signupDate = new Date(user.createdAt);
  const history = buildWeeklyHistory(
    shifts,
    today,
    user.weekStartsOn,
    user.rate,
    completedWeekCountSince(signupDate, today, user.weekStartsOn),
    signupDate,
    dayExpenses,
    weekExtras
  );
  const weeks = history.slice().reverse();
  const filteredWeeks = weeks.filter((week) => weekOverlapsRange(week, dateRange));
  const allHistoryRange = history.length > 0
    ? { from: history[0].startISO, to: history[history.length - 1].endISO }
    : null;
  const rangeLabel = formatHistoryDateRange(dateRange);

  return (
    <div className="screen-narrow">
      <div className="history-page-heading">
        <div className="history-page-heading-copy">
          <h1 className="section-title">History</h1>
          <div className="section-hint">
            Completed weekly reports, most recent first. Open a week to download its PDF or correct a day's hours.
          </div>
        </div>
        <HistoryDateRangePicker
          today={today}
          value={dateRange}
          allHistoryRange={allHistoryRange}
          onChange={setDateRange}
        />
      </div>
      <EarningsHiddenHint className="history-earnings-hint" />

      {weeks.length === 0 ? (
        <div className="card anim-rise">
          <EmptyState
            icon={<HistoryIcon size={25} />}
            title="No completed weeks yet"
            description="Your first weekly summary will appear here when your current weekly cycle ends."
          />
        </div>
      ) : filteredWeeks.length === 0 ? (
        <div className="card anim-rise history-range-empty">
          <EmptyState
            icon={<CalendarIcon size={25} />}
            title="No reports in this range"
            description={`There are no completed weekly PDFs overlapping ${rangeLabel}. Choose another period to continue.`}
            action={allHistoryRange ? (
              <button type="button" className="btn btn-secondary" onClick={() => setDateRange(allHistoryRange)}>
                View all reports
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <>
          <div className="history-range-summary" aria-live="polite">
            <span><strong>{filteredWeeks.length}</strong> weekly {filteredWeeks.length === 1 ? "report" : "reports"}</span>
            <span>{rangeLabel}</span>
          </div>
          <ul className="history-week-list" key={`${dateRange.from}:${dateRange.to}`}>
          {filteredWeeks.map((week) => (
            <WeekCard
              key={week.startISO}
              week={week}
              metGoal={week.earnings >= user.goalEarnings}
              onEditDay={setEditing}
            />
          ))}
          </ul>
        </>
      )}

      {editing && (
        <DayEditorSheet
          // Keyed by date so switching directly from one day to another
          // remounts the form rather than carrying the previous day's
          // half-typed values across.
          key={editing.dateISO}
          target={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
