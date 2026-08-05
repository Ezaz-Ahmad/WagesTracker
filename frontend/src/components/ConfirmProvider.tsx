import { useEffect, useRef, useState } from "react";
import { AlertTriangleIcon, CheckCircleIcon } from "./icons";

interface PendingConfirm {
  message: string;
  tone: "default" | "danger";
  resolve: (ok: boolean) => void;
}

/**
 * Requires an in-app "Are you sure?" popup before a button click is allowed
 * to do anything — replacing the browser's native `confirm()` with one
 * consistent, styled dialog. Opt-in, not opt-out: only buttons explicitly
 * marked `data-confirm="..."` are gated. Routine, frequent, or reversible
 * actions (switching tabs, saving settings, logging in, clocking in/out,
 * downloading a PDF) are left alone — a popup on every single click was
 * tried and was more annoying than useful. This is reserved for actions
 * that lose data or end a session: clearing/removing a shift, logging out,
 * deleting the account.
 *
 * How it works: a capture-phase listener on `document` sees every click
 * before React's own event system does. If the clicked button has
 * `data-confirm`, we cancel the click (`preventDefault` +
 * `stopImmediatePropagation`) and show the popup instead. If the user
 * confirms, we re-`click()` that exact button — flagged with a one-time
 * bypass so it isn't re-intercepted — which lets the button's real behavior
 * (including a form's submit-on-click default action) run normally.
 *
 * Per-button customization (read straight off the DOM node):
 *   - `data-confirm="Custom question?"` — required to opt a button in.
 *   - `data-confirm-tone="danger"` — red/warning styling for destructive
 *     actions (delete, remove, clear, log out). Defaults to the neutral tone.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const bypass = useRef<WeakSet<Element>>(new WeakSet());
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  pendingRef.current = pending;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      const btn = target.closest("button");
      if (!btn || btn.disabled) return;

      if (bypass.current.has(btn)) {
        bypass.current.delete(btn);
        return;
      }
      const message = btn.getAttribute("data-confirm");
      if (!message) return; // opt-in: only buttons explicitly marked need a popup
      if (pendingRef.current) return; // a popup is already open — ignore

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const tone = btn.getAttribute("data-confirm-tone") === "danger" ? "danger" : "default";

      setPending({
        message,
        tone,
        resolve: (ok) => {
          setPending(null);
          if (ok) {
            bypass.current.add(btn);
            btn.click();
          }
        },
      });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (pending) confirmBtnRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") pendingRef.current?.resolve(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  return (
    <>
      {children}
      {pending && (
        <div className="confirm-backdrop" onClick={() => pending.resolve(false)}>
          <div
            className={`confirm-modal${pending.tone === "danger" ? " is-danger" : ""}`}
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-modal-icon" aria-hidden="true">
              {pending.tone === "danger" ? <AlertTriangleIcon size={26} /> : <CheckCircleIcon size={26} />}
            </div>
            <p className="confirm-modal-message">{pending.message}</p>
            <div className="confirm-modal-actions">
              <button type="button" className="confirm-action-btn confirm-action-cancel" onClick={() => pending.resolve(false)}>
                Cancel
              </button>
              <button
                type="button"
                ref={confirmBtnRef}
                className="confirm-action-btn confirm-action-confirm"
                onClick={() => pending.resolve(true)}
              >
                {pending.tone === "danger" ? "Yes, continue" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
