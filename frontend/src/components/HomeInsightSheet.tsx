import { useId, useRef, type ReactNode } from "react";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
import { CloseIcon } from "./icons";
import { Overlay } from "./Overlay";

interface HomeInsightSheetProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  onClose: () => void;
  live?: boolean;
}

/**
 * Shared details surface for Home insights. On phones it behaves like a
 * native bottom sheet; on larger screens it becomes a compact centred modal.
 * It deliberately animates only opacity and transforms so opening a detail
 * view never forces the dashboard behind it to reflow.
 */
export function HomeInsightSheet({ eyebrow, title, description, icon, children, onClose, live = false }: HomeInsightSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { closing, requestClose } = useDismissTransition(190);
  const dismiss = () => requestClose(onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, dismiss, closeButtonRef);

  return (
    <Overlay>
      <div className={`home-insight-backdrop${closing ? " is-closing" : ""}`} onClick={dismiss}>
        <section
          ref={dialogRef}
          className={`home-insight-sheet${closing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="home-insight-grabber" aria-hidden="true" />
          <header className="home-insight-head">
            <span className="home-insight-icon" aria-hidden="true">{icon}</span>
            <div className="home-insight-heading-copy">
              <span className="home-insight-eyebrow">{eyebrow}</span>
              <h2 id={titleId}>{title}</h2>
              <p id={descriptionId}>{description}</p>
            </div>
            <button ref={closeButtonRef} type="button" className="home-insight-close" onClick={dismiss} aria-label={`Close ${eyebrow.toLowerCase()}`}>
              <CloseIcon size={18} />
            </button>
          </header>

          {live && (
            <div className="home-insight-live" role="status">
              <span aria-hidden="true" /> Updating from your active shift
            </div>
          )}

          <div className="home-insight-body">{children}</div>
          <footer className="home-insight-footer">
            <button type="button" className="btn btn-primary" onClick={dismiss}>Done</button>
          </footer>
        </section>
      </div>
    </Overlay>
  );
}
