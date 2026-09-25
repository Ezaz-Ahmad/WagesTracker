import { useCallback, useEffect, useRef, useState } from "react";
import { APP_ERROR_EVENT, type ErrorFeedback } from "../lib/errorFeedback";
import { Overlay } from "./Overlay";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useDismissTransition } from "../lib/useDismissTransition";

export function ErrorPopup() {
  const [error, setError] = useState<ErrorFeedback | null>(null);
  const dismiss = useDismissTransition(180);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const handlingInvalidRef = useRef(false);

  useEffect(() => {
    const onError = (event: Event) => setError((event as CustomEvent<ErrorFeedback>).detail);
    const onInvalid = (event: Event) => {
      const field = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!field?.validationMessage) return;
      event.preventDefault();
      if (handlingInvalidRef.current) return;
      handlingInvalidRef.current = true;
      setError({
        title: "Check this field",
        message: field.validationMessage,
        hint: "Your entries are still here. Correct the highlighted field and try again.",
        field: field.dataset.errorField,
      });
      window.setTimeout(() => { handlingInvalidRef.current = false; }, 100);
    };
    window.addEventListener(APP_ERROR_EVENT, onError);
    window.addEventListener("invalid", onInvalid, true);
    return () => {
      window.removeEventListener(APP_ERROR_EVENT, onError);
      window.removeEventListener("invalid", onInvalid, true);
    };
  }, []);

  const closeAndFocus = useCallback(() => {
    const field = error?.field;
    dismiss.requestClose(() => {
      setError(null);
      if (!field) return;
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-error-field]"))
        .find((element) => element.dataset.errorField === field);
      if (!target) return;
      // Let the focus-trap cleanup restore its previous target first, then
      // deliberately land on the field that can resolve this error.
      window.setTimeout(() => {
        target.focus({ preventScroll: false });
        target.scrollIntoView?.({ block: "center", behavior: "smooth" });
        target.classList.add("field-error-pulse");
        window.setTimeout(() => target.classList.remove("field-error-pulse"), 900);
      }, 0);
    });
  }, [dismiss, error?.field]);
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(error), closeAndFocus, closeButtonRef);

  if (!error) return null;
  return (
    <Overlay>
      <div className={`dialog-backdrop app-error-backdrop${dismiss.closing ? " is-closing" : ""}`} onClick={closeAndFocus}>
        <div
          ref={dialogRef}
          className={`dialog app-error-dialog${dismiss.closing ? " is-closing" : ""}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="app-error-title"
          aria-describedby={`app-error-message${error.hint ? " app-error-hint" : ""}`}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="app-error-mark" aria-hidden="true">!</div>
          <div>
            <h2 className="dialog-title" id="app-error-title">{error.title ?? "We couldn't complete that"}</h2>
            <p className="dialog-body" id="app-error-message">{error.message}</p>
            {error.suggestion && <p className="app-error-suggestion">Suggested email: <strong>{error.suggestion}</strong></p>}
            {error.hint && <p className="app-error-hint" id="app-error-hint">{error.hint}</p>}
          </div>
          <div className="dialog-actions">
            <button ref={closeButtonRef} type="button" className="btn btn-primary" onClick={closeAndFocus}>
              Review and fix
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
