import { useCallback, useEffect, useId, useRef, useState } from "react";
import { APP_ERROR_EVENT, type ErrorFeedback } from "../lib/errorFeedback";
import { conflictSchedule, parseShiftConflict, type ConflictShift } from "../lib/shiftConflict";
import { Overlay } from "./Overlay";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useDismissTransition } from "../lib/useDismissTransition";
import { AlertTriangleIcon, InfoIcon } from "./icons";

type Entry = { id: number; feedback: ErrorFeedback; focusTarget: HTMLElement | null; signature: string };

function ShiftCard({ label, shift, saved = false }: { label: string; shift: ConflictShift; saved?: boolean }) {
  const schedule = conflictSchedule(shift);
  return <section className={`error-shift-card${saved ? " is-saved" : ""}`} aria-label={label}>
    <p className="error-shift-label">{label}</p>
    <strong className="error-shift-job">{shift.jobName}</strong>
    {shift.location && <p className="error-shift-location">{shift.location}</p>}
    <p className="error-shift-date">{schedule.date}</p>
    <p className="error-shift-times"><span>{schedule.start || "Not set"}</span><span aria-hidden="true">–</span><span>{schedule.end || (saved ? "Still running" : "No end time")}</span></p>
    {schedule.endDate && <p className="error-shift-overnight">Ends {schedule.endDate}</p>}
  </section>;
}

function ErrorDialog({ entry, onDismiss }: { entry: Entry; onDismiss: () => void }) {
  const error = entry.feedback;
  const id = useId();
  const { closing, requestClose } = useDismissTransition(200);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeAndFocus = useCallback(() => {
    requestClose(() => {
      const target = error.field
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-error-field]")).find(element => element.dataset.errorField === error.field)
        : entry.focusTarget;
      onDismiss();
      // Focus-trap cleanup runs first, then the relevant field receives focus.
      if (!target || target === document.body) return;
      window.setTimeout(() => {
        if (!document.contains(target)) return;
        target.focus({ preventScroll: false });
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
      }, 0);
    });
  }, [entry.focusTarget, error.field, onDismiss, requestClose]);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, closeAndFocus, closeButtonRef);
  const Icon = error.tone === "info" ? InfoIcon : AlertTriangleIcon;
  const conflict = error.conflict;

  return <Overlay>
    <div className={`dialog-backdrop app-error-backdrop${closing ? " is-closing" : ""}`} onClick={event => { if (event.target === event.currentTarget) closeAndFocus(); }}>
      <div ref={dialogRef} className={`dialog app-error-dialog app-error-${error.tone || "warning"}${closing ? " is-closing" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-message${error.hint ? ` ${id}-hint` : ""}`} tabIndex={-1}>
        <header className="app-error-header">
          <span className="app-error-mark" aria-hidden="true"><Icon size={20} /></span>
          <h2 className="dialog-title" id={`${id}-title`}>{error.title || "Check these details"}</h2>
        </header>
        <div className="app-error-content">
          <p className="dialog-body" id={`${id}-message`}>{error.message}</p>
          {conflict && <div className="error-shift-comparison">
            <ShiftCard label={conflict.kind === "running" ? "Trying to start" : "Your change"} shift={conflict.attempted} />
            {conflict.conflicts.map((shift, index) => <ShiftCard key={index} label={conflict.kind === "running" ? "Already running" : conflict.conflicts.length > 1 ? `Saved shift ${index + 1}` : "Already saved"} shift={shift} saved />)}
            {conflict.totalConflicts > conflict.conflicts.length && <p className="app-error-hint">Also overlaps {conflict.totalConflicts - conflict.conflicts.length} more saved shifts. Review the full day in History.</p>}
          </div>}
          {error.suggestion && <p className="app-error-suggestion">Suggested email: <strong>{error.suggestion}</strong></p>}
          {error.hint && <p className="app-error-hint" id={`${id}-hint`}>{error.hint}</p>}
        </div>
        <footer className="dialog-actions app-error-actions">
          <button ref={closeButtonRef} type="button" className="btn btn-primary" disabled={closing} onClick={closeAndFocus}>{error.actionLabel || (error.field ? "Review and fix" : "Got it")}</button>
        </footer>
      </div>
    </div>
  </Overlay>;
}

export function ErrorPopup() {
  const [entry, setEntry] = useState<Entry | null>(null);
  const sequence = useRef(0);
  const invalidTimer = useRef<number>();
  const handlingInvalid = useRef(false);

  useEffect(() => {
    const receive = (feedback: ErrorFeedback, focusTarget?: HTMLElement) => {
      if (!feedback || typeof feedback.message !== "string" || !feedback.message.trim()) return;
      const clean = { ...feedback, conflict: parseShiftConflict(feedback.conflict) };
      const signature = JSON.stringify(clean);
      const id = ++sequence.current;
      setEntry(previous => previous?.signature === signature ? previous : { id, feedback: clean, signature, focusTarget: focusTarget ?? previous?.focusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null) });
    };
    const onError = (event: Event) => receive((event as CustomEvent<ErrorFeedback>).detail);
    const onInvalid = (event: Event) => {
      const field = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!field?.validationMessage) return;
      event.preventDefault();
      if (handlingInvalid.current) return;
      handlingInvalid.current = true;
      const label = (field.getAttribute("aria-label") || field.labels?.[0]?.textContent || "this field").replace(/\s+/g, " ").trim().replace(/\s*\*$/, "").slice(0, 64);
      const message = field.validity.valueMissing ? `${label.charAt(0).toUpperCase() + label.slice(1)} is required.` : field.validity.typeMismatch && field instanceof HTMLInputElement && field.type === "email" ? "Enter a valid email address, such as name@example.com." : field.validationMessage;
      receive({ title: label === "this field" ? "Check this field" : `Check ${label.toLowerCase()}`, message, field: field.dataset.errorField, actionLabel: "Review field", tone: "warning" }, field);
      invalidTimer.current = window.setTimeout(() => { handlingInvalid.current = false; }, 100);
    };
    window.addEventListener(APP_ERROR_EVENT, onError);
    window.addEventListener("invalid", onInvalid, true);
    return () => { window.removeEventListener(APP_ERROR_EVENT, onError); window.removeEventListener("invalid", onInvalid, true); clearTimeout(invalidTimer.current); };
  }, []);

  // A replacement error owns a fresh dismissal timer. An older dialog's exit
  // can never erase a new failure arriving from another outstanding request.
  return entry ? <ErrorDialog key={entry.id} entry={entry} onDismiss={() => setEntry(current => current?.id === entry.id ? null : current)} /> : null;
}
