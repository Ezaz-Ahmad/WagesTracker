import { useEffect, useRef, useState } from "react";
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
import { Amount } from "../components/Amount";
import { AmountWheelPicker } from "../components/AmountWheelPicker";

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
  // Which day's fuel-cost wheel picker is currently open, if any — the
  // picker itself is rendered once, driven by this, rather than one
  // instance per day.
  const [fuelPickerDate, setFuelPickerDate] = useState<string | null>(null);

  // Each day collapses into an accordion so the week always reads as a
  // short, organized list — every day starts closed regardless of whether
  // it already has entries. Tapping a header opens just that one day,
  // tracked here for the rest of the session.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  // The single "other earnings" entry for the week, edited via a small form
  // with a Save button (not autosave-on-blur like fuel cost) because it needs
  // both an amount and a reason together before it's valid.
  const [otherOpen, setOtherOpen] = useState<boolean | undefined>(undefined);
  const [otherSaving, setOtherSaving] = useState(false);
  const [otherHint, setOtherHint] = useState<string | null>(null);
  // Chosen via the wheel picker rather than typed, so this is real state
  // (not a ref read at save time like the old text input was).
  const [otherAmountValue, setOtherAmountValue] = useState(0);
  const [otherPickerOpen, setOtherPickerOpen] = useState(false);
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

  // Keeps the picker's starting value in sync with the saved amount until
  // the user actually opens the section this session (otherOpen still
  // undefined) — covers both the initial load (weekExtras arriving async)
  // and switching weeks. Once they've explicitly toggled it, this stops, so
  // it never clobbers an in-progress pick.
  useEffect(() => {
    if (otherOpen === undefined) setOtherAmountValue(otherAmount);
  }, [otherAmount, otherOpen]);

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

  function isDayOpen(day: DayComputed): boolean {
    return openDays[day.dateISO] ?? false;
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
    // Freshly checked with nothing set yet — jump straight into the picker,
    // same continuity the old text input's autoFocus gave.
    if (checked && day.fuelCost === 0) setFuelPickerDate(day.dateISO);
  }

  /** Called when the wheel picker's "Done" is pressed for a given day —
   * replaces the old parse-on-blur handler now that the amount is chosen,
   * not typed. */
  function handleFuelAmountPick(day: DayComputed, amount: number) {
    const rounded = Math.round(amount * 100) / 100;
    if (rounded <= 0) {
      if (day.fuelCost > 0) void setFuelCost(day.dateISO, null);
      setFuelOpen((prev) => ({ ...prev, [day.dateISO]: false }));
      return;
    }
    void setFuelCost(day.dateISO, rounded);
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
    if (checked) {
      setOtherAmountValue(otherAmount > 0 ? otherAmount : 0);
      // Same continuity as fuel cost — nothing set yet, go straight to the picker.
      if (otherAmount === 0) setOtherPickerOpen(true);
    }
    if (!checked && otherAmount > 0) void setWeekExtra(weekStartISO, null, "");
  }

  async function handleOtherSave() {
    const reasonStr = (otherReasonRef.current?.value ?? "").trim();
    const amount = Math.round(otherAmountValue * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      setOtherHint("Pick an amount greater than 0.");
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
            {active ? (
              `Started at ${formatTime12(last?.signIn)} — tap to end shift.`
            ) : todayDay.hours > 0 || todayDay.fuelCost > 0 ? (
              <>
                {fmt2(todayDay.hours)}h · <Amount>{CURRENCY}{fmt2(todayDay.hours * user.rate + todayDay.fuelCost)}</Amount>
              </>
            ) : (
              "Tap to start your shift."
            )}
          </p>
          <ElapsedTimer active={active} signIn={last?.signIn ?? null} />
        </div>
        <ShiftButton active={active} onStart={handleShiftPress} onEnd={handleShiftPress} busy={busy} />
      </div>

      {days.map((day, i) => {
        const dayHasContent = day.shifts.length > 0 || (pending[day.dateISO]?.length ?? 0) > 0;
        const open = isDayOpen(day);
        // The collapsed-state summary is always about *where*, never a count
        // — hours/pay are already covered by the amount on the right, so
        // repeating "2 shifts" next to it was redundant. Multiple shifts at
        // different locations list all of them; duplicates collapse to one.
        const locations = Array.from(
          new Set(day.shifts.map((s) => s.location.trim()).filter((loc) => loc.length > 0))
        );
        const summary = dayHasContent ? (locations.length ? locations.join(", ") : null) : "No entries";
        return (
        <div
          key={day.dateISO}
          className={`day-card anim-rise${open ? " is-open" : ""}${dayHasContent ? " has-content" : ""}`}
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
            <span className="day-chevron-btn" aria-hidden="true">
              <ChevronDownIcon size={15} className="day-chevron" />
            </span>
            <div className="day-row-head-main">
              <div className="day-row-head-title">
                <span className="day-name">{day.dayAbbr}</span>
                <span className="day-date">{day.dateLabel}</span>
                {day.isToday && <span className="day-today-badge">Today</span>}
              </div>
              {summary && (
                <div className="day-row-summary" aria-hidden={open}>
                  {summary}
                </div>
              )}
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
                  <button
                    type="button"
                    className="fuel-amount fuel-amount-btn"
                    onClick={() => setFuelPickerDate(day.dateISO)}
                  >
                    <span className="fuel-amount-prefix">{CURRENCY}</span>
                    <span className="fuel-amount-value">{fmt2(day.fuelCost)}</span>
                  </button>
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
            <button
              type="button"
              className="fuel-amount other-amount fuel-amount-btn"
              onClick={() => setOtherPickerOpen(true)}
            >
              <span className="fuel-amount-prefix">{CURRENCY}</span>
              <span className="fuel-amount-value">{fmt2(otherAmountValue)}</span>
            </button>
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
            {fmt2(totalHours)}h · <Amount>{CURRENCY}{fmt2(totalEarningsAnim)}</Amount>
          </span>
        </div>
        {(weekFuelCost > 0 || otherAmount > 0) && (
          <div className="week-extras-breakdown">
            {weekFuelCost > 0 && (
              <div className="week-extras-row">
                <span>
                  <FuelIcon size={12} /> Fuel cost
                </span>
                <Amount>{CURRENCY}{fmt2(weekFuelCost)}</Amount>
              </div>
            )}
            {otherAmount > 0 && (
              <div className="week-extras-row">
                <span>
                  <ExtraEarningIcon size={12} /> Other earnings
                  {currentWeekExtra?.reason ? ` — ${currentWeekExtra.reason}` : ""}
                </span>
                <Amount>{CURRENCY}{fmt2(otherAmount)}</Amount>
              </div>
            )}
          </div>
        )}
      </div>

      {fuelPickerDate &&
        (() => {
          const day = days.find((d) => d.dateISO === fuelPickerDate);
          if (!day) return null;
          return (
            <AmountWheelPicker
              title={`Fuel cost — ${day.dayAbbr} ${day.dateLabel}`}
              currency={CURRENCY}
              initialAmount={day.fuelCost}
              onCancel={() => setFuelPickerDate(null)}
              onDone={(amount) => {
                handleFuelAmountPick(day, amount);
                setFuelPickerDate(null);
              }}
            />
          );
        })()}

      {otherPickerOpen && (
        <AmountWheelPicker
          title="Other earnings amount"
          currency={CURRENCY}
          initialAmount={otherAmountValue}
          onCancel={() => setOtherPickerOpen(false)}
          onDone={(amount) => {
            setOtherAmountValue(amount);
            setOtherPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
