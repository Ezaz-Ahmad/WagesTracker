import { useState } from "react";
import { PasswordInput } from "../components/PasswordInput";
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
    <div className={`dialog-backdrop${closing ? " is-closing" : ""}`} onClick={close}>
      <div
        ref={trapRef}
        className={`dialog${closing ? " is-closing" : ""}`}
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
          This permanently deletes your account, your saved settings, and every shift you've logged. There's no way
          to undo this. Enter your password to confirm.
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
          <button type="button" className="btn btn-danger btn-destructive-final" onClick={handleDelete} disabled={deleting || !password}>
            {deleting ? "Deleting…" : "Yes, permanently delete my account"}
          </button>
        </div>
      </div>
    </div>
  );
}
