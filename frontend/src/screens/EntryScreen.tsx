import { useEffect, useRef, useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import {
  buildWeekDaysComputed,
  groupByDate,
  groupExpensesByDate,
  isDateInWeek,
  weekExtraFor,
  weekTotals,
  type DayComputed,
  type ShiftComputed,
} from "../lib/aggregate";
import { buildWeekDays, fmt2, formatTime12, isoDate } from "../lib/date";
import { useTodayShift } from "../lib/useTodayShift";
import { useCountUp } from "../lib/useCountUp";
import { useLiveElapsedHours } from "../lib/useLiveElapsedHours";
import { ElapsedTimer, ShiftButton } from "../components/ShiftButton";
import { ChevronDownIcon, ExtraEarningIcon, FuelIcon, LocationPinIcon } from "../components/icons";
import { Skeleton } from "../components/Skeleton";
import { Amount } from "../components/Amount";
import { AmountWheelPicker } from "../components/AmountWheelPicker";
import { WorkLocationPicker } from "../components/WorkLocationPicker";
import { AsyncButton } from "../components/AsyncButton";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";
import { useConfirm } from "../components/ConfirmProvider";
import { FUTURE_DATE_WARNING, isFutureDate, isUnusuallyLongShift, LONG_SHIFT_WARNING } from "../lib/shiftRules";
import type { WorkLocation } from "../lib/types";
import * as api from "../lib/api";

type Row = ShiftComputed & { tempId?: string };
type LocationPickerTarget =
  | { kind: "clock" }
  | { kind: "shift"; day: DayComputed; row: Row; rowIndex: number };

interface LocationDisplay {
  name: string;
  address: string;
  fuelAllowance: number | null;
  archived?: boolean;
}

function LocationPickerTrigger({
  id,
  label,
  location,
  emptyLabel,
  expanded,
  onClick,
}: {
  id: string;
  label: string;
  location: LocationDisplay | null;
  emptyLabel: string;
  expanded: boolean;
  onClick: () => void;
}) {
  const valueId = `${id}-value`;
  const triggerClassName = location ? "input location-picker-trigger has-value" : "input location-picker-trigger";
  return (
    <button
      id={id}
      type="button"
      className={triggerClassName}
      aria-label={`${label}: ${location?.name ?? emptyLabel}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span className="location-picker-trigger-icon" aria-hidden="true"><LocationPinIcon size={17} /></span>
      <span className="location-picker-trigger-copy">
        <span id={valueId} className="location-picker-trigger-name">{location?.name ?? emptyLabel}</span>
        {location && (
          <span className="location-picker-trigger-meta">
            {location.address && <span>{location.address}</span>}
            <span className={location.fuelAllowance == null ? "is-empty" : ""}>
              {location.fuelAllowance == null
                ? "No automatic fuel allowance"
                : `${CURRENCY}${fmt2(location.fuelAllowance)} fuel allowance/day`}
            </span>
            {location.archived && <span>Archived</span>}
          </span>
        )}
      </span>
      <ChevronDownIcon size={16} className="location-picker-trigger-chevron" />
    </button>
  );
}

function LiveEntryWeekTotal(props: {
  active: boolean;
  signIn: string | null;
  activeShiftInThisWeek: boolean;
  savedHours: number;
  savedEarnings: number;
  rate: number;
  weekFuelCost: number;
  otherAmount: number;
  otherReason: string | null;
}) {
  const ticking = props.active && props.activeShiftInThisWeek;
  const liveHours = useLiveElapsedHours(ticking, props.signIn);
  const totalHours = props.savedHours + liveHours;
  const totalEarnings = props.savedEarnings + liveHours * props.rate;
  const settledEarnings = useCountUp(ticking ? props.savedEarnings : totalEarnings, 650);
  const displayEarnings = ticking ? totalEarnings : settledEarnings;

  return (
    <div className="card elev-sm week-total-card anim-rise">
      <div className="week-total-row">
        <span>Total this week</span>
        <span className="count-value live-entry-total-slot" style={{ fontWeight: 800 }}>
          {fmt2(totalHours)}h · <Amount>{CURRENCY}{fmt2(displayEarnings)}</Amount>
        </span>
      </div>
      <EarningsHiddenHint />
      {(props.weekFuelCost > 0 || props.otherAmount > 0) && (
        <div className="week-extras-breakdown">
          {props.weekFuelCost > 0 && (
          <div className="week-extras-row"><span><FuelIcon size={12} /> Fuel allowance</span><Amount>{CURRENCY}{fmt2(props.weekFuelCost)}</Amount></div>
          )}
          {props.otherAmount > 0 && (
            <div className="week-extras-row">
              <span><ExtraEarningIcon size={12} /> Other earnings{props.otherReason ? ` — ${props.otherReason}` : ""}</span>
              <Amount>{CURRENCY}{fmt2(props.otherAmount)}</Amount>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EntryScreen({ onManageLocations = () => {} }: { onManageLocations?: () => void } = {}) {
  const confirm = useConfirm();
  const {
    today,
    user,
    shifts,
    shiftsLoaded,
    createShift,
    updateShift,
    removeShift,
    workLocations,
    dayExpenses,
    setFuelCost,
    weekExtras,
    setWeekExtra,
  } = useApp();
  const { active, last, startAtLocation, end } = useTodayShift();
  const [busy, setBusy] = useState(false);
  const [entryActionBusy, setEntryActionBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const [locationSuggestions, setLocationSuggestions] = useState<Record<string, string[]>>({});
  const [draftLocations, setDraftLocations] = useState<Record<string, string>>({});
  const [clockLocationId, setClockLocationId] = useState("");
  const [clockLocationError, setClockLocationError] = useState<string | null>(null);
  const [locationPickerTarget, setLocationPickerTarget] = useState<LocationPickerTarget | null>(null);
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
  // Acknowledging a future day is scoped to this mounted Entry screen. This
  // avoids asking twice while the user fills sign-in, sign-out, and fuel for
  // the same planned day, but a fresh visit still gets a fresh warning.
  const futureDateAcknowledgedRef = useRef<Set<string>>(new Set());

  // Hooks below must run every render regardless of loading state, so the
  // bail-out has to come after all of them — see HomeScreen for the same fix.
  const rate = user?.rate ?? 0;
  const weekStartsOn = user?.weekStartsOn ?? "Monday";

  const weekDays = buildWeekDays(today, weekStartsOn);
  const weekStartISO = isoDate(weekDays[0]);
  const allLocations = workLocations ?? [];
  const activeLocations = allLocations.filter((location) => !location.archived);
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
  // Only counted here if the open shift's *own* starting date actually falls
  // in the week currently on screen — an overnight shift that started the
  // night before a week boundary (e.g. Sunday into a Monday-start week)
  // belongs entirely to the previous week (see isDateInWeek/computeHours),
  // so without this check its live hours would show up in this week first
  // and then visibly jump back to the previous week the moment it's signed
  // out and actually saved under its real date.
  const activeShiftInThisWeek = !!last && isDateInWeek(last.date, weekDays);

  // Keeps the picker's starting value in sync with the saved amount until
  // the user actually opens the section this session (otherOpen still
  // undefined) — covers both the initial load (weekExtras arriving async)
  // and switching weeks. Once they've explicitly toggled it, this stops, so
  // it never clobbers an in-progress pick.
  useEffect(() => {
    if (otherOpen === undefined) setOtherAmountValue(otherAmount);
  }, [otherAmount, otherOpen]);

  useEffect(() => {
    let cancelled = false;
    void api.getWorkLocationSuggestions(weekStartISO)
      .then(({ suggestions }) => { if (!cancelled) setLocationSuggestions(suggestions); })
      .catch(() => { if (!cancelled) setLocationSuggestions({}); });
    return () => { cancelled = true; };
  }, [weekStartISO]);

  useEffect(() => {
    // A location the user explicitly chose for today's clock-in always wins.
    // Suggestions are only an initial convenience; re-applying one whenever
    // clockLocationId changes would immediately undo a manual picker choice.
    if (clockLocationId && activeLocations.some((location) => location.id === clockLocationId)) {
      return;
    }
    if (activeLocations.length === 1) {
      setClockLocationId(activeLocations[0].id);
      return;
    }
    const todaySuggestion = locationSuggestions[isoDate(today)]?.[0];
    if (todaySuggestion && activeLocations.some((location) => location.id === todaySuggestion)) {
      setClockLocationId(todaySuggestion);
    } else if (clockLocationId) {
      setClockLocationId("");
    }
  }, [workLocations, locationSuggestions, today, clockLocationId]);

  if (!user) return null;
  // Same reasoning as Home: don't render totals off the empty initial `shifts`
  // array, or they'll flicker from $0 to the real total the instant it loads.
  if (!shiftsLoaded || !todayDay) {
    return (
      <div className="screen-narrow">
        <h1 className="section-title">This week's hours</h1>
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
        workLocationId: null,
        signIn: null,
        signOut: null,
        hours: 0,
        hoursLabel: "—",
        canRemove: true,
        tempId,
      });
    });
    return rows.map((row, index) => {
      if (row.id) return row;
      const key = locationDraftKey(day.dateISO, row, index);
      const remembered = locationSuggestions[day.dateISO]?.[index];
      const automatic = activeLocations.length === 1
        ? activeLocations[0].id
        : remembered && activeLocations.some((location) => location.id === remembered)
          ? remembered
          : "";
      const workLocationId = draftLocations[key] ?? automatic;
      const location = activeLocations.find((item) => item.id === workLocationId)?.name ?? "";
      return { ...row, workLocationId: workLocationId || null, location };
    });
  }

  function pendingAutomaticFuelForRows(renderedRows: Row[]): number {
    const workedLocationIds = new Set(
      renderedRows
        .filter((row) => !!row.signIn && !!row.workLocationId)
        .map((row) => row.workLocationId as string)
    );
    const pendingAllowanceByLocation = new Map<string, number>();
    renderedRows.forEach((row) => {
      if (!row.workLocationId || row.signIn || workedLocationIds.has(row.workLocationId)) return;
      const location = activeLocations.find((item) => item.id === row.workLocationId);
      if (location?.fuelAllowance != null) pendingAllowanceByLocation.set(location.id, location.fuelAllowance);
    });
    return Array.from(pendingAllowanceByLocation.values()).reduce((sum, amount) => sum + amount, 0);
  }

  function locationDraftKey(dateISO: string, row: Row, index: number): string {
    return `${dateISO}:${row.tempId ?? row.id ?? `placeholder-${index}`}`;
  }

  function clearPending(dateISO: string, tempId?: string) {
    if (!tempId) return;
    setPending((prev) => ({ ...prev, [dateISO]: (prev[dateISO] ?? []).filter((id) => id !== tempId) }));
  }

  async function handleFieldChange(day: DayComputed, row: Row, field: "signIn" | "signOut", value: string): Promise<boolean> {
    const normalized = value || null;
    const mergedSignIn = field === "signIn" ? value || null : row.signIn;
    const mergedSignOut = field === "signOut" ? value || null : row.signOut;
    if (!(await confirmFutureDate(day))) return false;
    if (isUnusuallyLongShift(mergedSignIn, mergedSignOut) && !(await confirm(LONG_SHIFT_WARNING))) {
      return false;
    }
    const allowFutureDate = isFutureDate(day.dateISO, today);
    if (row.id) {
      await updateShift(row.id, { [field]: normalized, ...(allowFutureDate ? { allowFutureDate: true } : {}) });
      return true;
    }
    if (!row.workLocationId) {
      setClockLocationError(activeLocations.length === 0
        ? "Add a work location in Settings before saving a shift."
        : "Choose a work location before saving this shift.");
      return false;
    }
    setClockLocationError(null);
    await createShift({
      date: day.dateISO,
      workLocationId: row.workLocationId ?? null,
      location: row.location,
      signIn: field === "signIn" ? value || null : row.signIn,
      signOut: field === "signOut" ? value || null : row.signOut,
      ...(allowFutureDate ? { allowFutureDate: true } : {}),
    });
    clearPending(day.dateISO, row.tempId);
    return true;
  }

  async function handleLocationChange(day: DayComputed, row: Row, index: number, workLocationId: string): Promise<boolean> {
    if (row.id) {
      const updated = await updateShift(row.id, { workLocationId, location: "" });
      return !!updated;
    }
    setDraftLocations((current) => ({
      ...current,
      [locationDraftKey(day.dateISO, row, index)]: workLocationId,
    }));
    setClockLocationError(null);
    return true;
  }

  function displayLocationFor(row: Row): LocationDisplay | null {
    if (!row.workLocationId && !row.location) return null;
    const location = allLocations.find((item) => item.id === row.workLocationId);
    const savedShift = row.id ? shifts.find((shift) => shift.id === row.id) : undefined;
    const savedAllowance = savedShift?.fuelAllowanceSnapshot;
    const fuelAllowance = savedShift && savedAllowance !== undefined
      ? savedAllowance
      : location?.fuelAllowance ?? null;
    return {
      name: location?.name ?? row.location,
      address: location?.address ?? "",
      fuelAllowance,
      archived: location?.archived ?? (!!row.workLocationId && !location),
    };
  }

  function historicalLocationFor(row: Row): Pick<WorkLocation, "id" | "name" | "address" | "fuelAllowance"> | null {
    if (!row.workLocationId || activeLocations.some((location) => location.id === row.workLocationId)) return null;
    const display = displayLocationFor(row);
    if (!display) return null;
    return { id: row.workLocationId, name: display.name, address: display.address, fuelAllowance: display.fuelAllowance };
  }

  function handleAddShift(dateISO: string) {
    setPending((prev) => ({ ...prev, [dateISO]: [...(prev[dateISO] ?? []), crypto.randomUUID()] }));
  }

  async function handleRemoveShift(day: DayComputed, row: Row) {
    const target = `remove:${row.id ?? row.tempId ?? day.dateISO}`;
    if (entryActionBusy) return;
    setEntryActionBusy(target);
    try {
      if (row.id) {
        await removeShift(row.id);
      } else {
        clearPending(day.dateISO, row.tempId);
      }
    } finally {
      setEntryActionBusy(null);
    }
  }

  async function handleClearDay(day: DayComputed) {
    // Confirmation now happens up front via the button's data-confirm popup
    // (see ConfirmProvider) instead of the browser's native confirm().
    if (entryActionBusy) return;
    setEntryActionBusy(`clear:${day.dateISO}`);
    try {
      const ids = day.shifts.map((s) => s.id).filter((id): id is string => !!id);
      await Promise.all(ids.map((id) => removeShift(id)));
      setPending((prev) => ({ ...prev, [day.dateISO]: [] }));
    } finally {
      setEntryActionBusy(null);
    }
  }

  async function handleShiftPress() {
    if (!active && !clockLocationId) {
      setClockLocationError(activeLocations.length === 0
        ? "Add a work location in Settings before starting a shift."
        : "Choose today's work location before starting your shift.");
      setOpenDays((current) => ({ ...current, [isoDate(today)]: true }));
      return;
    }
    setBusy(true);
    try {
      if (active) await end();
      else {
        setClockLocationError(null);
        await startAtLocation(clockLocationId);
      }
    } finally {
      setBusy(false);
    }
  }

  function isDayOpen(day: DayComputed): boolean {
    return openDays[day.dateISO] ?? false;
  }

  function toggleDay(dateISO: string, current: boolean) {
    setOpenDays((prev) => ({ ...prev, [dateISO]: !current }));
  }

  async function confirmFutureDate(day: DayComputed): Promise<boolean> {
    if (!isFutureDate(day.dateISO, today) || futureDateAcknowledgedRef.current.has(day.dateISO)) return true;
    const accepted = await confirm(
      `${FUTURE_DATE_WARNING}\n\nDate: ${day.dayAbbr} ${day.dateLabel}.`,
      "danger",
    );
    if (accepted) futureDateAcknowledgedRef.current.add(day.dateISO);
    return accepted;
  }

  async function handleFuelAmountPick(day: DayComputed, amount: number) {
    if (!(await confirmFutureDate(day))) return;
    const rounded = Math.round(amount * 100) / 100;
    if (rounded <= 0) {
      await setFuelCost(day.dateISO, null, isFutureDate(day.dateISO, today));
      return;
    }
    await setFuelCost(day.dateISO, rounded, isFutureDate(day.dateISO, today));
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
      {/* PDF export lives on the Report screen only now — having the same
          "Download PDF" action in two places was redundant, and Report is
          the screen actually built around reporting/exporting. */}
      <h1 className="section-title">This week's hours</h1>
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
          {!active && (
            <div className="entry-clock-location">
              <span className="entry-clock-location-label">Today's work location</span>
              <LocationPickerTrigger
                id="entry-clock-location"
                label="Today's work location"
                location={activeLocations.find((location) => location.id === clockLocationId) ?? null}
                emptyLabel={activeLocations.length ? "Choose a location" : "Add a work location"}
                expanded={locationPickerTarget?.kind === "clock"}
                onClick={() => setLocationPickerTarget({ kind: "clock" })}
              />
              {activeLocations.length === 0 && (
                <div className="field-hint">No locations configured — use Manage work locations to add one.</div>
              )}
            </div>
          )}
          {clockLocationError && <div className="field-hint field-hint-danger" role="alert">{clockLocationError}</div>}
        </div>
        <ShiftButton active={active} onStart={handleShiftPress} onEnd={handleShiftPress} busy={busy} />
      </div>

      {days.map((day, i) => {
        const dayHasContent = day.shifts.length > 0 || (pending[day.dateISO]?.length ?? 0) > 0;
        const open = isDayOpen(day);
        const renderedRows = rowsFor(day);
        // The collapsed-state summary is always about *where*, never a count
        // — hours/pay are already covered by the amount on the right, so
        // repeating "2 shifts" next to it was redundant. Multiple shifts at
        // different locations list all of them; duplicates collapse to one.
        const locations = Array.from(
          new Set(day.shifts.map((s) => s.location.trim()).filter((loc) => loc.length > 0))
        );
        const summary = dayHasContent ? (locations.length ? locations.join(", ") : null) : "No entries";
        const fuelExpense = dayExpenses.find((expense) => expense.date === day.dateISO);
        const automaticFuel = fuelExpense?.automaticFuelAllowance ?? 0;
        const hasManualFuel = fuelExpense?.source === "manual" || fuelExpense?.manualOverride != null;
        const pendingAutomaticFuel = pendingAutomaticFuelForRows(renderedRows);
        const isFuelPreview = !hasManualFuel && automaticFuel <= 0 && pendingAutomaticFuel > 0;
        const displayedFuelAmount = isFuelPreview ? pendingAutomaticFuel : day.fuelCost;
        return (
        <div
          key={day.dateISO}
          className={`day-card anim-rise${open ? " is-open" : ""}${dayHasContent ? " has-content" : ""}`}
          style={{ ["--i" as string]: Math.min(i, 4) }}
        >
          <div className="day-row-head">
            {/* A real <button> for the accordion trigger — not a <div
                role="button"> with the separate Clear <button> nested
                inside it. A <button> inside another interactive element is
                an invalid, unreliably-operable pattern for assistive tech
                (activating the outer one can also activate/confuse focus
                on the inner one). Clear lives in .day-row-actions as a
                sibling instead, exactly as before visually, but no longer
                nested inside the toggle. */}
            {/* aria-expanded said "this thing opens" but nothing said *what*
                it opens, so a screen-reader user had no way to jump from the
                toggle to the panel it controls. The panel is always in the
                DOM (it's collapsed with CSS, not unmounted) so a stable id
                pair is all that's needed. */}
            <button
              type="button"
              className="day-row-toggle"
              aria-expanded={open}
              aria-controls={`day-panel-${day.dateISO}`}
              onClick={() => toggleDay(day.dateISO, open)}
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
            </button>
            <div className="day-row-actions">
              <div className={`day-hours${day.hours > 0 ? "" : " is-empty"}`}>{day.hoursLabel}</div>
              {dayHasContent && (
                <AsyncButton
                  type="button"
                  className="btn btn-ghost day-clear-btn"
                  onClick={() => void handleClearDay(day)}
                  busy={entryActionBusy === `clear:${day.dateISO}`}
                  disabled={entryActionBusy !== null && entryActionBusy !== `clear:${day.dateISO}`}
                  idleLabel="Clear"
                  busyLabel="Clearing…"
                  data-confirm={`Clear all shifts for ${day.dayAbbr}, ${day.dateLabel}? This can't be undone.`}
                  data-confirm-tone="danger"
                />
              )}
            </div>
          </div>

          <div className="day-row-collapse" id={`day-panel-${day.dateISO}`} role="region" aria-label={`${day.dayAbbr} ${day.dateLabel} entries`}>
            <div className="day-row-body">
              {renderedRows.map((row, rowIndex) => {
                const rowKey = `${day.dateISO}-${row.id ?? row.tempId ?? "placeholder"}`;
                const selectedLocation = displayLocationFor(row);
                return (
                <div className="shift-row" key={rowKey}>
                  <div className="shift-field shift-field-location">
                    <span className="shift-field-label">Location</span>
                    <LocationPickerTrigger
                      id={`shift-location-${rowKey}`}
                      label={`Location for ${day.dayAbbr} ${day.dateLabel}`}
                      location={selectedLocation}
                      emptyLabel={activeLocations.length ? "Choose a location" : "Add a work location"}
                      expanded={locationPickerTarget?.kind === "shift" && locationPickerTarget.day.dateISO === day.dateISO && locationPickerTarget.rowIndex === rowIndex}
                      onClick={() => setLocationPickerTarget({ kind: "shift", day, row, rowIndex })}
                    />
                  </div>
                  <div className="shift-field shift-field-time">
                    {/* A real label rendered by us, not the native placeholder — an
                        empty <input type="time"> looks completely different by
                        platform (desktop Chrome draws a "--:-- --" placeholder;
                        iOS/Android draw their own native control with no such
                        text), so relying on that to say "this is sign-in" left
                        phones with no visible cue at all. This label looks
                        identical everywhere regardless of how the native picker
                        renders. */}
                    <label className="shift-field-label" htmlFor={`shift-signin-${rowKey}`}>Sign in</label>
                    <input
                      id={`shift-signin-${rowKey}`}
                      className="input shift-time"
                      type="time"
                      aria-label="Sign-in time"
                      title="Sign-in time"
                      defaultValue={row.signIn ?? ""}
                      onChange={async (e) => {
                        const input = e.currentTarget;
                        if (!(await handleFieldChange(day, row, "signIn", input.value))) input.value = row.signIn ?? "";
                      }}
                    />
                  </div>
                  <div className="shift-field shift-field-time">
                    <label className="shift-field-label" htmlFor={`shift-signout-${rowKey}`}>Sign out</label>
                    <input
                      id={`shift-signout-${rowKey}`}
                      className="input shift-time"
                      type="time"
                      aria-label="Sign-out time"
                      title="Sign-out time"
                      defaultValue={row.signOut ?? ""}
                      onChange={async (e) => {
                        const input = e.currentTarget;
                        if (!(await handleFieldChange(day, row, "signOut", input.value))) input.value = row.signOut ?? "";
                      }}
                    />
                  </div>
                  <div className="shift-hours">{row.hoursLabel}</div>
                  {row.canRemove && (
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost shift-remove"
                      onClick={() => void handleRemoveShift(day, row)}
                      aria-label={entryActionBusy === `remove:${row.id ?? row.tempId ?? day.dateISO}` ? "Removing shift…" : "Remove shift"}
                      aria-busy={entryActionBusy === `remove:${row.id ?? row.tempId ?? day.dateISO}` || undefined}
                      disabled={entryActionBusy !== null}
                      title="Remove shift"
                      data-confirm="Remove this shift entry? This can't be undone."
                      data-confirm-tone="danger"
                    >
                      {entryActionBusy === `remove:${row.id ?? row.tempId ?? day.dateISO}`
                        ? <span className="compact-loader is-visible" aria-hidden="true" />
                        : "×"}
                    </button>
                  )}
                </div>
                );
              })}
              <button className="btn btn-ghost add-shift-btn" onClick={() => handleAddShift(day.dateISO)}>
                + Add another shift
              </button>

              <div className="fuel-row">
                <div className="fuel-row-info">
                  <div className="fuel-toggle">
                    <FuelIcon size={14} />
                    <span>Fuel allowance</span>
                    {(automaticFuel > 0 || hasManualFuel) && (
                      <span className={`fuel-source-badge${hasManualFuel ? " is-manual" : ""}`}>
                        {hasManualFuel ? "Manual override" : "Automatic"}
                      </span>
                    )}
                  </div>
                  <div className="fuel-row-detail">
                    {hasManualFuel
                      ? `Your editable value is used for this date. The calculated branch total is ${CURRENCY}${fmt2(automaticFuel)}.`
                      : automaticFuel > 0
                        ? `Calculated once per worked location from saved sign-ins (${CURRENCY}${fmt2(automaticFuel)}).`
                        : pendingAutomaticFuel > 0
                          ? `${CURRENCY}${fmt2(pendingAutomaticFuel)} is ready from the selected location and will be added after a sign-in is saved.`
                          : "Choose a location with a saved allowance, or set a value manually."}
                  </div>
                </div>
                <div className="fuel-row-actions">
                  <button
                    type="button"
                    className="fuel-amount fuel-amount-btn is-open"
                    onClick={() => setFuelPickerDate(day.dateISO)}
                    aria-label={`${isFuelPreview ? "Preview" : hasManualFuel ? "Edit" : "Set"} fuel allowance for ${day.dayAbbr}; current value ${CURRENCY}${fmt2(displayedFuelAmount)}${isFuelPreview ? ", applied after sign-in" : ""}`}
                  >
                    <span className="fuel-amount-prefix">{CURRENCY}</span>
                    <span className="fuel-amount-value">{fmt2(displayedFuelAmount)}</span>
                  </button>
                  {hasManualFuel && (
                    <button
                      type="button"
                      className="btn btn-ghost fuel-restore-btn"
                      onClick={async () => {
                        if (await confirmFutureDate(day)) {
                          await setFuelCost(day.dateISO, null, isFutureDate(day.dateISO, today));
                        }
                      }}
                    >
                      Restore automatic{automaticFuel > 0 ? ` (${CURRENCY}${fmt2(automaticFuel)})` : ""}
                    </button>
                  )}
                </div>
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
        {/* Always mounted — the collapse is a grid-rows transition (same
            technique as the day accordion's day-row-collapse), not a
            conditional render, so unchecking "Other earnings" eases shut
            smoothly instead of the whole form vanishing the instant React
            would otherwise remove it. Bonus: an in-progress reason/amount
            now survives an accidental uncheck-recheck instead of being
            wiped, since the textarea node itself never actually unmounts. */}
        <div className={`other-earning-collapse${otherChecked ? " is-open" : ""}`}>
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
              <AsyncButton className="btn btn-secondary" onClick={handleOtherSave} busy={otherSaving} idleLabel="Save" busyLabel="Saving…" />
              {otherHint && <span className="other-earning-hint">{otherHint}</span>}
            </div>
          </div>
        </div>
      </div>

      <LiveEntryWeekTotal
        active={active}
        signIn={last?.signIn ?? null}
        activeShiftInThisWeek={activeShiftInThisWeek}
        savedHours={savedHours}
        savedEarnings={savedEarnings}
        rate={rate}
        weekFuelCost={weekFuelCost}
        otherAmount={otherAmount}
        otherReason={currentWeekExtra?.reason ?? null}
      />

      {locationPickerTarget && (() => {
        const isClock = locationPickerTarget.kind === "clock";
        const selectedId = isClock ? clockLocationId || null : locationPickerTarget.row.workLocationId ?? null;
        const historicalSelection = isClock ? null : historicalLocationFor(locationPickerTarget.row);
        return (
          <WorkLocationPicker
            title={isClock
              ? "Choose today's work location"
              : `Choose a location — ${locationPickerTarget.day.dayAbbr} ${locationPickerTarget.day.dateLabel}`}
            locations={activeLocations}
            selectedId={selectedId}
            historicalSelection={historicalSelection}
            onSelect={async (locationId) => {
              if (isClock) {
                setClockLocationId(locationId);
                setClockLocationError(null);
                return true;
              }
              return handleLocationChange(
                locationPickerTarget.day,
                locationPickerTarget.row,
                locationPickerTarget.rowIndex,
                locationId
              );
            }}
            onManageLocations={() => {
              setLocationPickerTarget(null);
              onManageLocations();
            }}
            onClose={() => setLocationPickerTarget(null)}
          />
        );
      })()}

      {fuelPickerDate &&
        (() => {
          const day = days.find((d) => d.dateISO === fuelPickerDate);
          if (!day) return null;
          const fuelExpense = dayExpenses.find((expense) => expense.date === day.dateISO);
          const automaticFuel = fuelExpense?.automaticFuelAllowance ?? 0;
          const hasManualFuel = fuelExpense?.source === "manual" || fuelExpense?.manualOverride != null;
          const pendingAutomaticFuel = pendingAutomaticFuelForRows(rowsFor(day));
          const initialAmount = !hasManualFuel && automaticFuel <= 0 && pendingAutomaticFuel > 0
            ? pendingAutomaticFuel
            : day.fuelCost;
          return (
            <AmountWheelPicker
              title={`Fuel allowance — ${day.dayAbbr} ${day.dateLabel}`}
              currency={CURRENCY}
              initialAmount={initialAmount}
              onCancel={() => setFuelPickerDate(null)}
              onDone={async (amount) => {
                setFuelPickerDate(null);
                await handleFuelAmountPick(day, amount);
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
