import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { buildWeekDaysComputed, groupByDate, weekTotals, type DayComputed, type ShiftComputed } from "../lib/aggregate";
import { buildWeekDays, fmt2, formatTime12 } from "../lib/date";
import { buildWeekReportData } from "../lib/reportData";
import { generateReportPdf } from "../pdf/generateReportPdf";
import { useTodayShift } from "../lib/useTodayShift";
import { useCountUp } from "../lib/useCountUp";
import { useLiveElapsedHours } from "../lib/useLiveElapsedHours";
import { ElapsedTimer, ShiftButton } from "../components/ShiftButton";

type Row = ShiftComputed & { tempId?: string };

export function EntryScreen() {
  const { today, user, shifts, shiftsLoaded, createShift, updateShift, removeShift } = useApp();
  const { active, last, start, end } = useTodayShift();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, string[]>>({});

  // Hooks below must run every render regardless of loading state, so the
  // bail-out has to come after all of them — see HomeScreen for the same fix.
  const rate = user?.rate ?? 0;
  const weekStartsOn = user?.weekStartsOn ?? "Monday";

  const weekDays = buildWeekDays(today, weekStartsOn);
  const shiftsByDate = groupByDate(shifts);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, CURRENCY, rate);
  const { hours: savedHours, earnings: savedEarnings } = weekTotals(days, rate);
  const todayDay = days.find((d) => d.isToday);

  // Same live-total treatment as the Home screen: the open shift's elapsed
  // time counts toward this week's total immediately, on top of what's saved.
  const liveHours = useLiveElapsedHours(active, last?.signIn ?? null);
  const totalHours = savedHours + liveHours;
  const totalEarnings = savedEarnings + liveHours * rate;
  // Show the exact live value every tick instead of easing toward it while a
  // shift is active — an ongoing eased chase toward a moving target reads as
  // "stuck," not live.
  const totalEarningsSmoothed = useCountUp(totalEarnings, 650);
  const totalEarningsAnim = active ? totalEarnings : totalEarningsSmoothed;

  if (!user) return null;
  // Same reasoning as Home: don't render totals off the empty initial `shifts`
  // array, or they'll flicker from $0 to the real total the instant it loads.
  if (!shiftsLoaded || !todayDay) {
    return (
      <div className="screen-narrow screen-transition">
        <h6 className="section-title">This week's hours</h6>
        <div className="section-hint">Loading your week…</div>
      </div>
    );
  }

  function rowsFor(day: DayComputed): Row[] {
    const rows: Row[] = day.shifts.map((s) => ({ ...s }));
    (pending[day.dateISO] ?? []).forEach((tempId) => {
      rows.push({
        id: null,
        shiftIndex: rows.length,
        location: "",
        signIn: null,
        signOut: null,
        hours: 0,
        hoursLabel: "—",
        canRemove: true,
        tempId,
      });
    });
    return rows;
  }

  function clearPending(dateISO: string, tempId?: string) {
    if (!tempId) return;
    setPending((prev) => ({ ...prev, [dateISO]: (prev[dateISO] ?? []).filter((id) => id !== tempId) }));
  }

  async function handleFieldChange(day: DayComputed, row: Row, field: "location" | "signIn" | "signOut", value: string) {
    const normalized = field === "location" ? value : value || null;
    if (row.id) {
      await updateShift(row.id, { [field]: normalized } as Partial<{ location: string; signIn: string | null; signOut: string | null }>);
      return;
    }
    await createShift({
      date: day.dateISO,
      location: field === "location" ? value : row.location,
      signIn: field === "signIn" ? value || null : row.signIn,
      signOut: field === "signOut" ? value || null : row.signOut,
    });
    clearPending(day.dateISO, row.tempId);
  }

  function handleAddShift(dateISO: string) {
    setPending((prev) => ({ ...prev, [dateISO]: [...(prev[dateISO] ?? []), crypto.randomUUID()] }));
  }

  async function handleRemoveShift(day: DayComputed, row: Row) {
    if (row.id) {
      await removeShift(row.id);
    } else {
      clearPending(day.dateISO, row.tempId);
    }
  }

  async function handleClearDay(day: DayComputed) {
    if (!window.confirm(`Clear all shifts for ${day.dayAbbr}, ${day.dateLabel}?`)) return;
    const ids = day.shifts.map((s) => s.id).filter((id): id is string => !!id);
    await Promise.all(ids.map((id) => removeShift(id)));
    setPending((prev) => ({ ...prev, [day.dateISO]: [] }));
  }

  async function handleShiftPress() {
    setBusy(true);
    try {
      if (active) await end();
      else await start();
    } finally {
      setBusy(false);
    }
  }

  function handleDownloadPdf() {
    void generateReportPdf(buildWeekReportData(user!, shifts, today, CURRENCY));
  }

  return (
    <div className="screen-narrow">
      <div className="row-baseline">
        <h6 className="section-title">This week's hours</h6>
        <button className="btn btn-ghost" onClick={handleDownloadPdf} style={{ flex: "none" }}>
          Download PDF
        </button>
      </div>
      <div className="section-hint">Tap a time to set sign-in and sign-out for each day, or use the clock button for today.</div>

      <div className="card entry-today-card anim-rise">
        <div>
          <p className="card-body entry-today-sub">
            {active
              ? `Started at ${formatTime12(last?.signIn)} — tap to end shift.`
              : todayDay.hours > 0
                ? `${fmt2(todayDay.hours)}h · ${CURRENCY}${fmt2(todayDay.hours * user.rate)}`
                : "Tap to start your shift."}
          </p>
          <ElapsedTimer active={active} signIn={last?.signIn ?? null} />
        </div>
        <ShiftButton active={active} onStart={handleShiftPress} onEnd={handleShiftPress} busy={busy} />
      </div>

      {days.map((day, i) => {
        const dayHasContent = day.shifts.length > 0 || (pending[day.dateISO]?.length ?? 0) > 0;
        return (
        <div key={day.dateISO} className="day-row anim-rise" style={{ ["--i" as string]: Math.min(i, 4) }}>
          <div className="day-row-head">
            <div>
              <span className="day-name">{day.dayAbbr}</span>
              <span className="day-date">{day.dateLabel}</span>
            </div>
            <div className="day-row-actions">
              <div className={`day-hours${day.hours > 0 ? "" : " is-empty"}`}>{day.hoursLabel}</div>
              {dayHasContent && (
                <button type="button" className="btn btn-ghost day-clear-btn" onClick={() => handleClearDay(day)}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {rowsFor(day).map((row) => (
            <div className="shift-row" key={`${day.dateISO}-${row.id ?? row.tempId ?? "placeholder"}`}>
              <input
                className="input shift-location"
                type="text"
                placeholder="Location"
                defaultValue={row.location}
                onBlur={(e) => handleFieldChange(day, row, "location", e.target.value)}
              />
              <input
                className="input shift-time"
                type="time"
                defaultValue={row.signIn ?? ""}
                onChange={(e) => handleFieldChange(day, row, "signIn", e.target.value)}
              />
              <input
                className="input shift-time"
                type="time"
                defaultValue={row.signOut ?? ""}
                onChange={(e) => handleFieldChange(day, row, "signOut", e.target.value)}
              />
              <div className="shift-hours">{row.hoursLabel}</div>
              {row.canRemove && (
                <button className="btn btn-icon btn-ghost shift-remove" onClick={() => handleRemoveShift(day, row)}>
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="btn btn-ghost add-shift-btn" onClick={() => handleAddShift(day.dateISO)}>
            + Add another shift
          </button>
        </div>
        );
      })}

      <div className="card elev-sm week-total-card anim-rise">
        <div className="week-total-row">
          <span>Total this week</span>
          <span className="count-value" style={{ fontWeight: 800 }}>
            {fmt2(totalHours)}h · {CURRENCY}{fmt2(totalEarningsAnim)}
          </span>
        </div>
      </div>
    </div>
  );
}
