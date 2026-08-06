import { useRef, useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import {
  buildWeekDaysComputed,
  groupByDate,
  groupExpensesByDate,
  weekExtraFor,
  weekTotals,
  type DayComputed,
  type ShiftComputed,
} from "../lib/aggregate";
import { buildWeekDays, fmt2, formatTime12, isoDate } from "../lib/date";
import { buildWeekReportData } from "../lib/reportData";
import { generateReportPdf } from "../pdf/generateReportPdf";
import { useTodayShift } from "../lib/useTodayShift";
import { useCountUp } from "../lib/useCountUp";
import { useLiveElapsedHours } from "../lib/useLiveElapsedHours";
import { ElapsedTimer, ShiftButton } from "../components/ShiftButton";
import { ChevronDownIcon, ExtraEarningIcon, FuelIcon } from "../components/icons";
import { Skeleton } from "../components/Skeleton";

type Row = ShiftComputed & { tempId?: string };

export function EntryScreen() {
  const {
    today,
    user,
    shifts,
    shiftsLoaded,
    createShift,
    updateShift,
    removeShift,
    dayExpenses,
    setFuelCost,
    weekExtras,
    setWeekExtra,
  } = useApp();
  const { active, last, start, end } = useTodayShift();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, string[]>>({});
  // Manual override for the fuel-cost checkbox, keyed by date. Undefined means
  // "derive from whether that day already has a saved fuel cost" — this only
  // holds state while the user has the box open but hasn't entered/blurred an
  // amount yet, or has just unchecked it (before the save round-trips).
  const [fuelOpen, setFuelOpen] = useState<Record<string, boolean>>({});

  // Each day collapses into an accordion so a week with mostly-empty days
  // reads as a short, organized list instead of seven full blocks of empty
  // inputs. Undefined (not yet toggled by the user) falls back to a sensible
  // default — open for today and any day that already has entries, closed
  // otherwise — via `isDayOpen` below; once the user taps a header it's
  // tracked explicitly here for the rest of the session.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  // The single "other earnings" entry for the week, edited via a small form
  // with a Save button (not autosave-on-blur like fuel cost) because it needs
  // both an amount and a reason together before it's valid.
  const [otherOpen, setOtherOpen] = useState<boolean | undefined>(undefined);
  const [otherSaving, setOtherSaving] = useState(false);
  const [otherHint, setOtherHint] = useState<string | null>(null);
  const otherAmountRef = useRef<HTMLInputElement>(null);
  const otherReasonRef = useRef<HTMLTextAreaElement>(null);

  // Hooks below must run every render regardless of loading state, so the
  // bail-out has to come after all of them — see HomeScreen for the same fix.
  const rate = user?.rate ?? 0;
  const weekStartsOn = user?.weekStartsOn ?? "Monday";

  const weekDays = buildWeekDays(today, weekStartsOn);
  const weekStartISO = isoDate(weekDays[0]);
  const shiftsByDate = groupByDate(shifts);
  const expensesByDate = groupExpensesByDate(dayExpenses);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, CURRENCY, rate, expensesByDate);
  const { hours: savedHours, earnings: weekEarnings, fuelCost: weekFuelCost } = weekTotals(days, rate);
  const todayDay = days.find((d) => d.isToday);
  const currentWeekExtra = weekExtraFor(weekStartISO, weekExtras);
  const otherAmount = currentWeekExtra?.amount ?? 0;
  const savedEarnings = weekEarnings + otherAmount;

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
        <Skeleton className="skeleton-card" />
        <Skeleton className="skeleton-row" />
        <Skeleton className="skeleton-row" />
        <Skeleton className="skeleton-row" />
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
    // Confirmation now happens up front via the button's data-confirm popup
    // (see ConfirmProvider) instead of the browser's native confirm().
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
    void generateReportPdf(buildWeekReportData(user!, shifts, today, CURRENCY, dayExpenses, weekExtras));
  }

  function isDayOpen(day: DayComputed, dayHasContent: boolean): boolean {
    return openDays[day.dateISO] ?? (day.isToday || dayHasContent);
  }

  function toggleDay(dateISO: string, current: boolean) {
    setOpenDays((prev) => ({ ...prev, [dateISO]: !current }));
  }

  function isFuelChecked(day: DayComputed): boolean {
    return fuelOpen[day.dateISO] ?? day.fuelCost > 0;
  }

  function handleFuelToggle(day: DayComputed, checked: boolean) {
    setFuelOpen((prev) => ({ ...prev, [day.dateISO]: checked }));
    if (!checked && day.fuelCost > 0) void setFuelCost(day.dateISO, null);
  }

  function handleFuelAmountBlur(day: DayComputed, value: string) {
    const amount = Math.round(parseFloat(value) * 100) / 100;
    if (!value.trim() || !Number.isFinite(amount) || amount <= 0) {
      if (day.fuelCost > 0) void setFuelCost(day.dateISO, null);
      setFuelOpen((prev) => ({ ...prev, [day.dateISO]: false }));
      return;
    }
    void setFuelCost(day.dateISO, amount);
    setFuelOpen((prev) => {
      const next = { ...prev };
      delete next[day.dateISO];
      return next;
    });
  }

  const otherChecked = otherOpen ?? otherAmount > 0;

  function handleOtherToggle(checked: boolean) {
    setOtherOpen(checked);
    setOtherHint(null);
    if (!checked && otherAmount > 0) void setWeekExtra(weekStartISO, null, "");
  }

  async function handleOtherSave() {
    const amountStr = otherAmountRef.current?.value ?? "";
    const reasonStr = (otherReasonRef.current?.value ?? "").trim();
    const amount = Math.round(parseFloat(amountStr) * 100) / 100;
    if (!amountStr.trim() || !Number.isFinite(amount) || amount <= 0) {
      setOtherHint("Enter an amount greater than 0.");
      return;
    }
    if (!reasonStr) {
      setOtherHint("Add a short reason for this amount.");
      return;
    }
    setOtherSaving(true);
    setOtherHint(null);
    const ok = await setWeekExtra(weekStartISO, amount, reasonStr);
    setOtherSaving(false);
    if (ok) setOtherOpen(undefined);
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
              : todayDay.hours > 0 || todayDay.fuelCost > 0
                ? `${fmt2(todayDay.hours)}h · ${CURRENCY}${fmt2(todayDay.hours * user.rate + todayDay.fuelCost)}`
                : "Tap to start your shift."}
          </p>
          <ElapsedTimer active={active} signIn={last?.signIn ?? null} />
        </div>
        <ShiftButton active={active} onStart={handleShiftPress} onEnd={handleShiftPress} busy={busy} />
      </div>

      {days.map((day, i) => {
        const dayHasContent = day.shifts.length > 0 || (pending[day.dateISO]?.length ?? 0) > 0;
        const open = isDayOpen(day, dayHasContent);
        return (
        <div
          key={day.dateISO}
          className={`day-row anim-rise${open ? " is-open" : ""}`}
          style={{ ["--i" as string]: Math.min(i, 4) }}
        >
          <div
            className="day-row-head"
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => toggleDay(day.dateISO, open)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleDay(day.dateISO, open);
              }
            }}
          >
            <div className="day-row-head-left">
              <ChevronDownIcon size={16} className="day-chevron" />
              <span className="day-name">{day.dayAbbr}</span>
              <span className="day-date">{day.dateLabel}</span>
              {day.isToday && <span className="day-today-badge">Today</span>}
            </div>
            <div className="day-row-actions">
              <div className={`day-hours${day.hours > 0 ? "" : " is-empty"}`}>{day.hoursLabel}</div>
              {dayHasContent && (
                <button
                  type="button"
                  className="btn btn-ghost day-clear-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearDay(day);
                  }}
                  data-confirm={`Clear all shifts for ${day.dayAbbr}, ${day.dateLabel}? This can't be undone.`}
                  data-confirm-tone="danger"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="day-row-collapse">
            <div className="day-row-body">
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
                    <button
                      className="btn btn-icon btn-ghost shift-remove"
                      onClick={() => handleRemoveShift(day, row)}
                      aria-label="Remove shift"
                      data-confirm="Remove this shift entry? This can't be undone."
                      data-confirm-tone="danger"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button className="btn btn-ghost add-shift-btn" onClick={() => handleAddShift(day.dateISO)}>
                + Add another shift
              </button>

              <div className="fuel-row">
                <label className="checkbox fuel-toggle">
                  <input
                    type="checkbox"
                    checked={isFuelChecked(day)}
                    onChange={(e) => handleFuelToggle(day, e.target.checked)}
                  />
                  <span className="box" />
                  <FuelIcon size={14} />
                  Fuel cost
                </label>
                {isFuelChecked(day) && (
                  <div className="fuel-amount">
                    <span className="fuel-amount-prefix">{CURRENCY}</span>
                    <input
                      className="fuel-amount-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      autoFocus={fuelOpen[day.dateISO] === true && day.fuelCost === 0}
                      defaultValue={day.fuelCost > 0 ? day.fuelCost : ""}
                      onBlur={(e) => handleFuelAmountBlur(day, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        );
      })}

      <div className="card elev-sm other-earning-card anim-rise">
        <label className="checkbox fuel-toggle other-toggle">
          <input type="checkbox" checked={otherChecked} onChange={(e) => handleOtherToggle(e.target.checked)} />
          <span className="box" />
          <ExtraEarningIcon size={15} />
          Other earnings this week
        </label>
        <p className="card-body" style={{ margin: 0 }}>
          A one-off amount for the week — a tip, bonus, or reimbursement — added on top of your hours.
        </p>
        {otherChecked && (
          <div className="other-earning-form">
            <div className="fuel-amount other-amount">
              <span className="fuel-amount-prefix">{CURRENCY}</span>
              <input
                ref={otherAmountRef}
                className="fuel-amount-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                defaultValue={otherAmount > 0 ? otherAmount : ""}
              />
            </div>
            <textarea
              ref={otherReasonRef}
              className="input other-reason-input"
              placeholder={`What's this for? e.g. "Tip from Saturday shift"`}
              defaultValue={currentWeekExtra?.reason ?? ""}
              rows={2}
            />
            <div className="other-earning-actions">
              <button className="btn btn-secondary" onClick={handleOtherSave} disabled={otherSaving}>
                {otherSaving ? "Saving…" : "Save"}
              </button>
              {otherHint && <span className="other-earning-hint">{otherHint}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="card elev-sm week-total-card anim-rise">
        <div className="week-total-row">
          <span>Total this week</span>
          <span className="count-value" style={{ fontWeight: 800 }}>
            {fmt2(totalHours)}h · {CURRENCY}{fmt2(totalEarningsAnim)}
          </span>
        </div>
        {(weekFuelCost > 0 || otherAmount > 0) && (
          <div className="week-extras-breakdown">
            {weekFuelCost > 0 && (
              <div className="week-extras-row">
                <span>
                  <FuelIcon size={12} /> Fuel cost
                </span>
                <span>{CURRENCY}{fmt2(weekFuelCost)}</span>
              </div>
            )}
            {otherAmount > 0 && (
              <div className="week-extras-row">
                <span>
                  <ExtraEarningIcon size={12} /> Other earnings
                  {currentWeekExtra?.reason ? ` — ${currentWeekExtra.reason}` : ""}
                </span>
                <span>{CURRENCY}{fmt2(otherAmount)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
