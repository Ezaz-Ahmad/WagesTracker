import { useRef } from "react";
import { TAB_LABELS } from "../context/LayoutPreferencesContext";
import { TAB_HIDE_DETAILS, type HideableTab } from "../lib/tabVisibility";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
import { CheckCircleIcon, EyeOffIcon, InfoIcon } from "./icons";
import { Overlay } from "./Overlay";

export function HideTabDialog({ tab, warning, onCancel, onConfirm }: {
  tab: HideableTab;
  warning: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { closing, requestClose } = useDismissTransition(180);
  const cancel = () => requestClose(onCancel);
  const trapRef = useFocusTrap<HTMLDivElement>(true, cancel, cancelRef);
  const details = TAB_HIDE_DETAILS[tab];

  return (
    <Overlay>
      <div className={`confirm-backdrop layout-tab-confirm-backdrop${closing ? " is-closing" : ""}`} onClick={cancel}>
        <div ref={trapRef} className={`confirm-modal layout-tab-confirm${closing ? " is-closing" : ""}`}
          role="alertdialog" aria-modal="true" aria-labelledby="hide-tab-title"
          aria-describedby={`hide-tab-features hide-tab-impact${warning ? " hide-tab-warning" : ""}`} tabIndex={-1}
          onClick={(event) => event.stopPropagation()}>
          <span className="layout-tab-confirm-icon" aria-hidden="true"><EyeOffIcon size={24} /></span>
          <h2 id="hide-tab-title">Hide {TAB_LABELS[tab]}?</h2>
          <p id="hide-tab-features">{details.features}</p>
          <div className="layout-tab-impact" id="hide-tab-impact">
            <CheckCircleIcon size={18} />
            <div><strong>Wage calculations stay the same</strong><span>{details.impact}</span></div>
          </div>
          {warning && <p className="layout-tab-warning" id="hide-tab-warning"><InfoIcon size={17} /><span>{warning}</span></p>}
          <p className="layout-tab-restore-hint">You can show it again from App layout.</p>
          <div className="confirm-modal-actions">
            <button ref={cancelRef} type="button" className="confirm-action-btn confirm-action-cancel" disabled={closing} onClick={cancel}>Keep tab</button>
            <button type="button" className="confirm-action-btn confirm-action-confirm" disabled={closing} onClick={() => requestClose(onConfirm)}>Hide {TAB_LABELS[tab]}</button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
