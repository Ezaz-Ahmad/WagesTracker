import { useState } from "react";
import { RETENTION_YEARS, useApp } from "../context/AppContext";
import { AppCredit } from "../components/AppCredit";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

export function DataAccountSettings() {
  const { deleteAccount } = useApp();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  return (
    <div className="settings-section-card card">
      <h3 className="settings-subsection-title">Data retention</h3>
      <p className="settings-note settings-note-static">
        Time entries and reports are kept for {RETENTION_YEARS} years and automatically deleted after that. Log out
        from the button at the top of the app.
      </p>

      <div className="hr" />
      <h3 className="settings-subsection-title">About</h3>
      <AppCredit showVersion />
      <nav className="settings-policy-links" aria-label="Privacy and support">
        <a href="/privacy">Privacy Policy</a>
        <a href="/support">Support</a>
      </nav>

      <div className="hr" />
      <h3 className="settings-subsection-title settings-danger-title">Delete account</h3>
      <p className="section-hint">Permanently delete your account and every shift you've logged. This can't be undone.</p>
      <button type="button" className="btn btn-danger btn-block" onClick={() => setShowDeleteDialog(true)}>
        Delete account
      </button>

      {showDeleteDialog && <DeleteAccountDialog onClose={() => setShowDeleteDialog(false)} onDelete={deleteAccount} />}
    </div>
  );
}
