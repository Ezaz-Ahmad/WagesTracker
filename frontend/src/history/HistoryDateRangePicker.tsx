import { type FormEvent, useEffect, useRef, useState } from "react";
import { CalendarIcon, ChevronDownIcon, CloseIcon } from "../components/icons";
import {
  currentMonthRange,
  formatHistoryDateRange,
  previousMonthRange,
  rangesEqual,
  recentThreeMonthsRange,
  type HistoryDateRange,
} from "./historyDateRange";

interface HistoryDateRangePickerProps {
  today: Date;
  value: HistoryDateRange;
  allHistoryRange: HistoryDateRange | null;
  onChange: (range: HistoryDateRange) => void;
}

export function HistoryDateRangePicker({ today, value, allHistoryRange, onChange }: HistoryDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const thisMonth = currentMonthRange(today);
  const lastMonth = previousMonthRange(today);
  const lastThreeMonths = recentThreeMonthsRange(today);
  const displayRange = formatHistoryDateRange(value);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function openPicker() {
    setDraft(value);
    setError(null);
    setOpen(true);
    window.setTimeout(() => fromRef.current?.focus(), 0);
  }

  function closePicker(restoreFocus = false) {
    setOpen(false);
    setError(null);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function choosePreset(range: HistoryDateRange) {
    onChange(range);
    setDraft(range);
    closePicker(true);
  }

  function applyCustomRange(event: FormEvent) {
    event.preventDefault();
    if (!draft.from || !draft.to) {
      setError("Choose both a start and end date.");
      return;
    }
    if (draft.from > draft.to) {
      setError("The start date must be before the end date.");
      return;
    }
    onChange(draft);
    closePicker(true);
  }

  return (
    <div className="history-range-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`history-range-trigger${open ? " is-open" : ""}`}
        onClick={() => open ? closePicker() : openPicker()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Choose report date range. Showing ${displayRange}`}
      >
        <span className="history-range-trigger-icon" aria-hidden="true"><CalendarIcon size={18} /></span>
        <span className="history-range-trigger-copy">
          <span>Report period</span>
          <strong>{displayRange}</strong>
        </span>
        <ChevronDownIcon size={15} className={`history-range-chevron${open ? " is-open" : ""}`} />
      </button>

      {open && (
        <div className="history-range-popover elev-lg" role="dialog" aria-labelledby="history-range-title">
          <div className="history-range-popover-head">
            <div>
              <span className="card-kicker">PDF history</span>
              <h2 id="history-range-title">Choose a date range</h2>
              <p>Weekly reports that overlap your dates will be shown.</p>
            </div>
            <button type="button" className="btn btn-icon btn-ghost history-range-close" onClick={() => closePicker(true)} aria-label="Close date range picker">
              <CloseIcon size={17} />
            </button>
          </div>

          <div className="history-range-presets" aria-label="Quick date ranges">
            <button type="button" className={rangesEqual(value, thisMonth) ? "is-active" : ""} onClick={() => choosePreset(thisMonth)}>This month</button>
            <button type="button" className={rangesEqual(value, lastMonth) ? "is-active" : ""} onClick={() => choosePreset(lastMonth)}>Last month</button>
            <button type="button" className={rangesEqual(value, lastThreeMonths) ? "is-active" : ""} onClick={() => choosePreset(lastThreeMonths)}>Last 3 months</button>
            <button type="button" disabled={!allHistoryRange} className={allHistoryRange && rangesEqual(value, allHistoryRange) ? "is-active" : ""} onClick={() => allHistoryRange && choosePreset(allHistoryRange)}>All history</button>
          </div>

          <div className="history-range-divider"><span>or choose exact dates</span></div>
          <form onSubmit={applyCustomRange}>
            <div className="history-range-fields">
              <label>
                <span>From</span>
                <input ref={fromRef} className="input" type="date" value={draft.from} onChange={(event) => { setDraft((current) => ({ ...current, from: event.target.value })); setError(null); }} />
              </label>
              <label>
                <span>To</span>
                <input className="input" type="date" value={draft.to} onChange={(event) => { setDraft((current) => ({ ...current, to: event.target.value })); setError(null); }} />
              </label>
            </div>
            {error && <p className="history-range-error" role="alert">{error}</p>}
            <div className="history-range-actions">
              <button type="button" className="btn btn-ghost" onClick={() => closePicker(true)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Apply range</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
