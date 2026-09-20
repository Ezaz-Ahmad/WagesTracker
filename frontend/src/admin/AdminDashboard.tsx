import { useEffect, useMemo, useState } from "react";
import type { Shift, User } from "../lib/types";
import { AdminApiError, deleteUser, fetchAllUsers, fetchUserDetail, updateUserEmail, type AdminUserSummary } from "./adminApi";
import { Logo } from "../components/Logo";
import { Overlay } from "../components/Overlay";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
import { AsyncButton } from "../components/AsyncButton";
import { StatusBanner } from "../components/StatusBanner";
import { validateEmailAddress } from "../lib/emailPolicy";
import { showErrorPopup } from "../lib/errorFeedback";

const CURRENCY = "$";

function fmt2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AdminDashboard({
  onLogout,
  onAuthError,
}: {
  onLogout: () => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [detail, setDetail] = useState<{ user: User; shifts: Shift[] } | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [acceptedEmailAsEntered, setAcceptedEmailAsEntered] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminUserSummary | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Both dialogs below play a quick fade+scale-out on close instead of just
  // vanishing the instant their state clears — see useDismissTransition.
  const detailDismiss = useDismissTransition(180);
  const deleteDismiss = useDismissTransition(180);
  const detailTrapRef = useFocusTrap<HTMLDivElement>(Boolean(detail), closeDetail);
  const deleteTrapRef = useFocusTrap<HTMLDivElement>(Boolean(deleteTarget), closeDeleteDialog);

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUsers() {
    try {
      const { users } = await fetchAllUsers();
      setUsers(users);
      setLoadError(null);
    } catch (e) {
      if (onAuthError(e)) return;
      setLoadError(e instanceof AdminApiError ? e.message : "Couldn't load users");
    }
  }

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, query]);

  const totalShifts = useMemo(() => (users ?? []).reduce((a, u) => a + u.shiftCount, 0), [users]);

  async function handleView(u: AdminUserSummary) {
    setDetailLoadingId(u.id);
    setDetailError(null);
    try {
      const d = await fetchUserDetail(u.id);
      setDetail(d);
      setAdminEmail(d.user.email);
      setEmailError(null);
      setEmailMessage(null);
      setAcceptedEmailAsEntered(null);
    } catch (e) {
      if (onAuthError(e)) return;
      setDetailError(e instanceof AdminApiError ? e.message : "Couldn't load user");
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function handleEmailUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || emailSaving) return;
    const check = validateEmailAddress(adminEmail);
    setEmailError(null);
    setEmailMessage(null);
    if (!check.valid) {
      const message = check.error ?? "Enter a valid email address.";
      setEmailError(message);
      showErrorPopup({ title: "Check the email", message, hint: "Correct the highlighted field; no account data has changed.", field: "email" });
      return;
    }
    if (check.suggestion && acceptedEmailAsEntered !== check.normalized) {
      const message = `The part after @ may be misspelled. Did you mean ${check.suggestion}?`;
      setEmailError(message);
      showErrorPopup({ title: "Check the email", message, hint: "Use the suggestion or choose Keep mine before saving.", field: "email", suggestion: check.suggestion });
      return;
    }
    setEmailSaving(true);
    try {
      const result = await updateUserEmail(detail.user.id, adminEmail, acceptedEmailAsEntered === check.normalized);
      setDetail((current) => current ? { ...current, user: result.user } : current);
      setUsers((current) => current?.map((item) => item.id === result.user.id ? { ...item, email: result.user.email } : item) ?? current);
      setAdminEmail(result.user.email);
      setEmailMessage(result.message);
    } catch (error) {
      if (onAuthError(error)) return;
      setEmailError(error instanceof Error ? error.message : "Couldn't update the email.");
    } finally {
      setEmailSaving(false);
    }
  }

  function openDeleteDialog(u: AdminUserSummary) {
    setDeleteTarget(u);
    setDeleteConfirmText("");
    setDeleteError(null);
  }

  function closeDetail() {
    detailDismiss.requestClose(() => {
      setDetail(null);
      setDetailError(null);
    });
  }

  function closeDeleteDialog() {
    if (deleting) return;
    deleteDismiss.requestClose(() => setDeleteTarget(null));
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteUser(deleteTarget.id);
      setUsers((prev) => (prev ? prev.filter((u) => u.id !== deleteTarget.id) : prev));
      deleteDismiss.requestClose(() => {
        setDeleteTarget(null);
        setDeleteConfirmText("");
      });
    } catch (e) {
      if (onAuthError(e)) return;
      setDeleteError(e instanceof AdminApiError ? e.message : "Couldn't delete user");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="admin-shell">
      <header className="nav admin-nav">
        <span className="nav-brand admin-brand">
          <Logo size={20} />
          <span className="admin-brand-copy">
            <strong>Wage Tracker</strong>
            <small>Admin panel</small>
          </span>
        </span>
        <button className="btn btn-secondary" onClick={onLogout}>
          Log out
        </button>
      </header>

      <main className="admin-frame screen-transition">
        <section className="admin-page-heading" aria-labelledby="admin-dashboard-title">
          <div>
            <p className="admin-eyebrow">Account management</p>
            <h1 id="admin-dashboard-title">Admin dashboard</h1>
            <p>Review accounts, update login emails, check shift history, and manage users.</p>
          </div>
        </section>

        {loadError && (
          <div className="form-error" style={{ marginBottom: "var(--space-3)" }}>
            {loadError}
          </div>
        )}
        {detailError && !detail && (
          <div className="form-error" role="alert" style={{ marginBottom: "var(--space-3)" }}>
            {detailError}
          </div>
        )}

        <div className="stat-grid admin-stat-grid">
          <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 0 }}>
            <div className="card-kicker">Total users</div>
            <div className="card-title stat-tile-value-lg count-value">{users?.length ?? "—"}</div>
          </div>
          <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 1 }}>
            <div className="card-kicker">Total shifts logged</div>
            <div className="card-title stat-tile-value-lg count-value">{users ? totalShifts : "—"}</div>
          </div>
          <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 2 }}>
            <div className="card-kicker">Matching search</div>
            <div className="card-title stat-tile-value-lg count-value">{users ? filtered.length : "—"}</div>
          </div>
        </div>

        <section className="admin-directory" aria-labelledby="admin-users-title">
          <div className="admin-toolbar">
            <div>
              <h2 className="section-title" id="admin-users-title">User directory</h2>
              <p className="section-hint" aria-live="polite">
                {users ? `${filtered.length} of ${users.length} ${users.length === 1 ? "account" : "accounts"}` : "Loading accounts…"}
              </p>
            </div>
            <div className="admin-search-field">
              <label htmlFor="admin-user-search">Search users</label>
              <input
                id="admin-user-search"
                className="input admin-search"
                type="search"
                placeholder="Name or email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {users === null && !loadError ? (
            <div className="admin-empty-state section-hint">Loading accounts…</div>
          ) : filtered.length === 0 ? (
            <div className="admin-empty-state anim-rise">
              <strong>{users && users.length > 0 ? "No matching users" : "No users yet"}</strong>
              <p>{users && users.length > 0 ? "Try a different name or email address." : "New accounts will appear here after signup."}</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="table admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Work location</th>
                    <th>Rate</th>
                    <th>Goals</th>
                    <th>Shifts</th>
                    <th>Joined</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u, i) => (
                    <tr key={u.id} style={{ ["--i" as string]: i }}>
                      <td data-label="Name" className="admin-user-name">{u.name}</td>
                      <td data-label="Email" className="admin-user-email">{u.email}</td>
                      <td data-label="Work location">{u.workLocationName || "—"}</td>
                      <td data-label="Rate">
                        {CURRENCY}
                        {fmt2(u.rate)}/hr
                      </td>
                      <td data-label="Goals">
                        {u.goalHours}h · {CURRENCY}
                        {fmt2(u.goalEarnings)}
                      </td>
                      <td data-label="Shifts">{u.shiftCount}</td>
                      <td data-label="Joined">{fmtDate(u.createdAt)}</td>
                      <td className="admin-row-actions">
                        <div className="admin-action-group">
                          <AsyncButton aria-label={`View ${u.name}`} className="btn btn-ghost" onClick={() => handleView(u)} busy={detailLoadingId === u.id} idleLabel="View" busyLabel="Loading…" />
                          <button aria-label={`Delete ${u.name}`} className="btn btn-danger" onClick={() => openDeleteDialog(u)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {detail && (
        <Overlay>
        <div
          className={`dialog-backdrop${detailDismiss.closing ? " is-closing" : ""}`}
          onClick={closeDetail}
        >
          <div
            ref={detailTrapRef}
            className={`dialog admin-detail-dialog${detailDismiss.closing ? " is-closing" : ""}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-user-detail-title"
            tabIndex={-1}
          >
            <div className="admin-detail-header">
              <div>
                <p className="admin-eyebrow">User account</p>
                <h2 className="dialog-title" id="admin-user-detail-title">{detail.user.name}</h2>
              </div>
              <button type="button" className="admin-dialog-close" onClick={closeDetail} aria-label="Close user details">×</button>
            </div>
            <dl className="admin-detail-summary">
              <div><dt>Email</dt><dd>{detail.user.email}</dd></div>
              <div><dt>Work location</dt><dd>{detail.user.workLocationName || "Not set"}</dd></div>
              <div><dt>Hourly rate</dt><dd>{CURRENCY}{fmt2(detail.user.rate)}/hr</dd></div>
              <div><dt>Weekly goal</dt><dd>{detail.user.goalHours}h · {CURRENCY}{fmt2(detail.user.goalEarnings)}</dd></div>
              <div><dt>Week starts</dt><dd>{detail.user.weekStartsOn}</dd></div>
              <div><dt>Shifts logged</dt><dd>{detail.shifts.length}</dd></div>
            </dl>
            {detailError && <div className="form-error">{detailError}</div>}
            <form className="admin-email-editor" onSubmit={handleEmailUpdate} noValidate>
              <h3>Edit login email</h3>
              <p className="section-hint">This changes only the login email. The user's password, signed-in devices, shifts, reports, and settings stay the same.</p>
              {emailError && <div className="form-error" role="alert">{emailError}</div>}
              {emailMessage && <StatusBanner tone="success">{emailMessage}</StatusBanner>}
              <div className="field">
                <label htmlFor="admin-edit-email">Email</label>
                <input
                  id="admin-edit-email"
                  className="input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={adminEmail}
                  onChange={(event) => { setAdminEmail(event.target.value); setAcceptedEmailAsEntered(null); setEmailError(null); setEmailMessage(null); }}
                  data-error-field="email"
                  aria-invalid={emailError ? true : undefined}
                  required
                />
              </div>
              {(() => {
                const check = adminEmail ? validateEmailAddress(adminEmail) : null;
                if (!check?.valid || !check.suggestion || acceptedEmailAsEntered === check.normalized) return null;
                return <div className="email-suggestion" role="status">
                  <span>Did you mean <strong>{check.suggestion}</strong>?</span>
                  <span className="email-suggestion-actions">
                    <button type="button" className="auth-text-link" onClick={() => { setAdminEmail(check.suggestion!); setAcceptedEmailAsEntered(null); }}>Use suggestion</button>
                    <button type="button" className="auth-text-link" onClick={() => setAcceptedEmailAsEntered(check.normalized)}>Keep mine</button>
                  </span>
                </div>;
              })()}
              <AsyncButton className="btn btn-secondary" type="submit" busy={emailSaving} idleLabel="Update email" busyLabel="Updating…" disabled={adminEmail.trim().toLowerCase() === detail.user.email.toLowerCase()} />
            </form>
            <div className="admin-detail-shifts">
              <div className="admin-section-heading">
                <h3>Shift history</h3>
                <span>{detail.shifts.length} {detail.shifts.length === 1 ? "shift" : "shifts"}</span>
              </div>
              {detail.shifts.length === 0 ? (
                <p className="admin-empty-state">No shifts logged.</p>
              ) : (
                <div className="admin-shifts-table-wrap">
                <table className="table admin-shifts-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Location</th>
                      <th>Sign in</th>
                      <th>Sign out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.shifts.map((s) => (
                      <tr key={s.id}>
                        <td data-label="Date">{s.date}</td>
                        <td data-label="Location">{s.location || "—"}</td>
                        <td data-label="Sign in">{s.signIn ?? "—"}</td>
                        <td data-label="Sign out">{s.signOut ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeDetail}>
                Close
              </button>
            </div>
          </div>
        </div>
        </Overlay>
      )}

      {deleteTarget && (
        <Overlay>
        <div className={`dialog-backdrop${deleteDismiss.closing ? " is-closing" : ""}`} onClick={closeDeleteDialog}>
          <div
            ref={deleteTrapRef}
            className={`dialog${deleteDismiss.closing ? " is-closing" : ""}`}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="admin-delete-title"
            aria-describedby="admin-delete-description"
            tabIndex={-1}
          >
            <h2 className="dialog-title" id="admin-delete-title">Delete {deleteTarget.name}?</h2>
            <p className="dialog-body" id="admin-delete-description">
              This permanently deletes this user's profile, settings, signed-in devices, shifts, expenses, and spending
              categories. There's no way to undo this. Type{" "}
              <strong>{deleteTarget.email}</strong> to confirm.
            </p>
            {deleteError && <div className="form-error">{deleteError}</div>}
            <div className="field">
              <label htmlFor="admin-delete-confirm-email">Confirm email</label>
              <input
                id="admin-delete-confirm-email"
                className="input"
                type="text"
                autoFocus
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeDeleteDialog} disabled={deleting}>
                Cancel
              </button>
              <AsyncButton
                className="btn btn-danger"
                onClick={handleDelete}
                busy={deleting}
                idleLabel="Delete user"
                busyLabel="Deleting…"
                disabled={deleteConfirmText.trim().toLowerCase() !== deleteTarget.email.toLowerCase()}
              />
            </div>
          </div>
        </div>
        </Overlay>
      )}
    </div>
  );
}
