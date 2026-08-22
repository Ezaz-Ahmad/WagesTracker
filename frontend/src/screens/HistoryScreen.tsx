import { useCallback, useState } from "react";
import { useApp } from "../context/AppContext";
import { buildWeeklyHistory } from "../lib/aggregate";
import { Skeleton } from "../components/Skeleton";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";
import { WeekCard } from "../history/WeekCard";
import { DayEditorSheet, type DayEditorTarget } from "../history/DayEditorSheet";
import { EmptyState } from "../components/EmptyState";
import { HistoryIcon } from "../components/icons";

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

  // Saving routes through AppContext, which replaces the shift in the one
  // canonical array every screen derives from. There is deliberately no
  // separate History cache to invalidate — the recalculation happens because
  // there is only one source, not because something remembered to refresh.
  const handleSave = useCallback(
    async (shiftId: string | null, values: { signIn: string; signOut: string; location: string; fuelCost: number | null; shiftChanged: boolean; fuelChanged: boolean }) => {
      if (!editing) return;
      // The throwing variants: the editor shows the failure next to the
      // values that caused it. The swallowing versions would route it to the
      // global banner behind the modal, where it would be invisible — the
      // same mistake the sessions drawer made before PR 3 fixed it.
      if (values.shiftChanged) {
        const shiftValues = { signIn: values.signIn, signOut: values.signOut, location: values.location };
        if (shiftId) await updateShiftOrThrow(shiftId, shiftValues);
        else await createShiftOrThrow({ date: editing.dateISO, ...shiftValues });
      }
      if (values.fuelChanged) await setFuelCostOrThrow(editing.dateISO, values.fuelCost);
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
        <h1 className="section-title">History</h1>
        <div className="section-hint">Completed weeks, most recent first.</div>
        <Skeleton className="skeleton-week-card" />
        <Skeleton className="skeleton-week-card" />
        <Skeleton className="skeleton-week-card" />
      </div>
    );
  }

  const history = buildWeeklyHistory(
    shifts,
    today,
    user.weekStartsOn,
    user.rate,
    20,
    new Date(user.createdAt),
    dayExpenses,
    weekExtras
  );
  const weeks = history.slice().reverse();

  return (
    <div className="screen-narrow">
      <h1 className="section-title">History</h1>
      <div className="section-hint">
        Completed weeks, most recent first. Open a week to download its PDF or correct a day's hours.
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
      ) : (
        <ul className="history-week-list">
          {weeks.map((week) => (
            <WeekCard
              key={week.startISO}
              week={week}
              metGoal={week.earnings >= user.goalEarnings}
              onEditDay={setEditing}
            />
          ))}
        </ul>
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
