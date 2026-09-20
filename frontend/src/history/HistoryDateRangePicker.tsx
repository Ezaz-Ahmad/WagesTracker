import { type FormEvent, useId, useRef, useState } from "react";
import { CalendarIcon, ChevronDownIcon, CloseIcon } from "../components/icons";
import { Overlay } from "../components/Overlay";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { closing, requestClose } = useDismissTransition(190);

  const thisMonth = currentMonthRange(today);
  const lastMonth = previousMonthRange(today);
  const lastThreeMonths = recentThreeMonthsRange(today);
  const displayRange = formatHistoryDateRange(value);
  const draftLabel = draft.from && draft.to && draft.from <= draft.to
    ? formatHistoryDateRange(draft)
    : "Choose both dates";

  function closePicker() {
    setError(null);
    requestClose(() => setOpen(false));
  }

  const dialogRef = useFocusTrap<HTMLElement>(open, closePicker, closeButtonRef);

  function openPicker() {
    setDraft(value);
    setError(null);
    setOpen(true);
    // Deliberately do not focus either date input here. Focusing a
    // type="date" input automatically launches iOS's native calendar and
    // resizes the viewport, which made the History screen jump on open.
    // The focus trap moves focus to the close button instead; the native
    // picker now appears only when the user explicitly taps From or To.
  }

  function choosePreset(range: HistoryDateRange) {
    onChange(range);
    setDraft(range);
    closePicker();
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
    closePicker();
  }

  const presets: Array<{ label: string; detail: string; range: HistoryDateRange | null }> = [
    { label: "This month", detail: formatHistoryDateRange(thisMonth), range: thisMonth },
    { label: "Last month", detail: formatHistoryDateRange(lastMonth), range: lastMonth },
    { label: "Last 3 months", detail: formatHistoryDateRange(lastThreeMonths), range: lastThreeMonths },
    { label: "All history", detail: allHistoryRange ? formatHistoryDateRange(allHistoryRange) : "No completed reports yet", range: allHistoryRange },
  ];

  return (
    <div className="history-range-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`history-range-trigger${open ? " is-open" : ""}`}
        onClick={openPicker}
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
        <Overlay>
          <div
            className={`history-range-backdrop${closing ? " is-closing" : ""}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closePicker();
            }}
          >
            <section
              ref={dialogRef}
              className={`history-range-modal${closing ? " is-closing" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              tabIndex={-1}
            >
              <div className="history-range-grabber" aria-hidden="true" />
              <header className="history-range-modal-head">
                <span className="history-range-modal-icon" aria-hidden="true"><CalendarIcon size={21} /></span>
                <div>
                  <span className="card-kicker">Past reports</span>
                  <h2 id={titleId}>Choose report period</h2>
                  <p id={descriptionId}>Show weekly PDFs that fall within your selected dates.</p>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="btn btn-icon btn-ghost history-range-close"
                  onClick={closePicker}
                  aria-label="Close date range picker"
                >
                  <CloseIcon size={18} />
                </button>
              </header>

              <form className="history-range-form" onSubmit={applyCustomRange}>
                <div className="history-range-current" aria-live="polite">
                  <span>Selected period</span>
                  <strong>{draftLabel}</strong>
                  <small>A week appears when at least one of its days falls within your dates.</small>
                </div>

                <fieldset className="history-range-preset-group">
                  <legend>Quick ranges</legend>
                  <div className="history-range-presets">
                    {presets.map((preset) => {
                      const active = !!preset.range && rangesEqual(value, preset.range);
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          disabled={!preset.range}
                          className={active ? "is-active" : ""}
                          onClick={() => preset.range && choosePreset(preset.range)}
                          aria-pressed={active}
                          aria-label={preset.label}
                        >
                          <strong>{preset.label}</strong>
                          <span>{preset.detail}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="history-range-divider"><span>or choose exact dates</span></div>
                <div className="history-range-fields">
                  <label>
                    <span>From</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.from}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, from: event.target.value }));
                        setError(null);
                      }}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.to}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, to: event.target.value }));
                        setError(null);
                      }}
                    />
                  </label>
                </div>
                {error && <p className="history-range-error" role="alert">{error}</p>}

                <footer className="history-range-actions">
                  <button type="button" className="btn btn-ghost" onClick={closePicker}>Cancel</button>
                  <button type="submit" className="btn btn-primary"><CalendarIcon size={16} /> Apply range</button>
                </footer>
              </form>
            </section>
          </div>
        </Overlay>
      )}
    </div>
  );
}
