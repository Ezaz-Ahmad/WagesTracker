import { useState } from "react";
import { Overlay } from "../components/Overlay";
import { PasswordInput } from "../components/PasswordInput";
import { AsyncButton } from "../components/AsyncButton";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useDismissTransition } from "../lib/useDismissTransition";

interface DeleteAccountDialogProps {
  onClose: () => void;
  onDelete: (password: string) => Promise<void>;
}

/**
 * A single, self-contained confirmation flow for account deletion: explain
 * what's deleted, require the current password, and one unmistakably
 * destructive final button — no second "are you sure?" popup layered on
 * top (ConfirmProvider's global ["data-confirm"] click interceptor is
 * deliberately not used on the final button here, since this dialog already
 * *is* the confirmation).
 */
export function DeleteAccountDialog({ onClose, onDelete }: DeleteAccountDialogProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { closing, requestClose } = useDismissTransition(180);

  function close() {
    if (deleting) return;
    requestClose(onClose);
  }

  const trapRef = useFocusTrap<HTMLDivElement>(true, close);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await onDelete(password);
      // On success the app flips to the logged-out state and this dialog unmounts.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete account");
      setDeleting(false);
    }
  }

  return (
    // Portalled for the same reason as the sessions drawer: rendered in
    // place, this dialog's fixed backdrop could be contained by an animated
    // screen transform rather than by the viewport, so it never covered the app
    // header and the page behind it kept scrolling. See components/Overlay.
    <Overlay>
        <div className={`dialog-backdrop delete-account-backdrop${closing ? " is-closing" : ""}`} onClick={close}>
        <div
          ref={trapRef}
          className={`dialog delete-account-dialog${closing ? " is-closing" : ""}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          aria-describedby="delete-account-desc"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div id="delete-account-title" className="dialog-title">
            Delete your account?
          </div>
          <p id="delete-account-desc" className="dialog-body">
            This permanently deletes your profile, saved settings, sessions, shifts, expenses, and spending
            categories. There's no way to undo this. Enter your password to confirm.
          </p>
          {error && (
            <div className="banner banner-danger" role="alert">
              <span>{error}</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="delete-account-password">Password</label>
            <PasswordInput
              id="delete-account-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password && !deleting) void handleDelete();
              }}
            />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={close} disabled={deleting}>
              Cancel
            </button>
            <AsyncButton type="button" className="btn btn-danger btn-destructive-final" onClick={handleDelete} disabled={!password} busy={deleting} idleLabel="Permanently delete account" busyLabel="Deleting account…" />
          </div>
        </div>
      </div>
    </Overlay>
  );
}
