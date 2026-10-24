import { useEffect, useMemo, useRef, useState } from "react";
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
import { isoDate } from "../lib/date";
import { addIsoDays } from "../lib/weekBoundary.mjs";
import { AdminEarningsChart } from "./AdminEarningsChart";
import { AdminUserEarnings, adminMoney, adminWeekLabel } from "./AdminUserEarnings";

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
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState("earnings");
  const today = isoDate(new Date());

  const [detail, setDetail] = useState<{ user: User; shifts: Shift[] } | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"earnings" | "account">("earnings");
  const detailRequest = useRef(0);
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
    let active = true;
    setUsers(null);
    setLoadError(null);
    void fetchAllUsers(anchor).then((result) => {
      if (active) setUsers(result.users);
    }).catch((e: unknown) => {
      if (!active || onAuthError(e)) return;
      setLoadError(e instanceof AdminApiError ? e.message : "Couldn't load users");
    });
    return () => { active = false; };
  }, [anchor, refresh, onAuthError]);

  useEffect(() => () => { detailRequest.current++; }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    const matches = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    return matches.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "shifts" ? b.shiftCount - a.shiftCount : (b.earnings?.total ?? 0) - (a.earnings?.total ?? 0));
  }, [users, query, sort]);

  const totalShifts = useMemo(() => (users ?? []).reduce((a, u) => a + u.shiftCount, 0), [users]);
  const totalEarned = (users ?? []).reduce((sum, u) => sum + (u.earnings?.total ?? 0), 0);
  const totalHours = (users ?? []).reduce((sum, u) => sum + (u.earnings?.hours ?? 0), 0);

  async function handleView(u: AdminUserSummary) {
    const requestId = ++detailRequest.current;
    setDetailLoadingId(u.id);
    setDetailError(null);
    try {
      const d = await fetchUserDetail(u.id);
      if (requestId !== detailRequest.current) return;
      setDetail(d);
      setDetailTab("earnings");
      setAdminEmail(d.user.email);
      setEmailError(null);
      setEmailMessage(null);
      setEmailSaving(false);
      setAcceptedEmailAsEntered(null);
    } catch (e) {
      if (requestId !== detailRequest.current) return;
      if (onAuthError(e)) return;
      setDetailError(e instanceof AdminApiError ? e.message : "Couldn't load user");
    } finally {
      if (requestId === detailRequest.current) setDetailLoadingId(null);
    }
  }

  async function handleEmailUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || emailSaving) return;
    const userId = detail.user.id;
    const requestId = detailRequest.current;
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
      const result = await updateUserEmail(userId, adminEmail, acceptedEmailAsEntered === check.normalized);
      setUsers((current) => current?.map((item) => item.id === result.user.id ? { ...item, email: result.user.email } : item) ?? current);
      if (requestId !== detailRequest.current) return;
      setDetail((current) => current?.user.id === userId ? { ...current, user: result.user } : current);
      setAdminEmail(result.user.email);
      setEmailMessage(result.message);
    } catch (error) {
      if (requestId !== detailRequest.current) return;
      if (onAuthError(error)) return;
      setEmailError(error instanceof Error ? error.message : "Couldn't update the email.");
    } finally {
      if (requestId === detailRequest.current) setEmailSaving(false);
    }
  }

  function openDeleteDialog(u: AdminUserSummary) {
    detailRequest.current++;
    setDetailLoadingId(null);
    setDeleteTarget(u);
    setDeleteConfirmText("");
    setDeleteError(null);
  }

  function closeDetail() {
    detailRequest.current++;
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
            <strong>Wages Tracker</strong>
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
            <p className="admin-eyebrow">Wages Tracker / Administration</p>
            <h1 id="admin-dashboard-title">Admin dashboard</h1>
            <p>A clearer view of your users, their working weeks, and what they earn.</p>
          </div>
          <button className="btn btn-secondary admin-refresh" onClick={() => setRefresh((value) => value + 1)} disabled={!users && !loadError}>↻ Refresh</button>
        </section>

        <section className="admin-period-bar" aria-label="Dashboard reporting period">
          <div><span className="admin-period-dot" /><strong>{anchor === today ? "This week's overview" : "Historical overview"}</strong><p>Each account follows its own week start day.</p></div>
          <div className="admin-period-controls">
            <button className="admin-week-arrow" aria-label="Previous overview week" onClick={() => setAnchor(addIsoDays(anchor, -7))}>←</button>
            <div className="admin-date-field"><label htmlFor="admin-overview-date">Week containing</label><input id="admin-overview-date" className="input" type="date" max={today} value={anchor} onChange={(event) => { const value = event.target.value; if (value && value <= today) setAnchor(value); }} /></div>
            <button className="admin-week-arrow" aria-label="Next overview week" disabled={anchor >= today} onClick={() => setAnchor(addIsoDays(anchor, 7) > today ? today : addIsoDays(anchor, 7))}>→</button>
            {anchor !== today && <button className="btn btn-ghost" onClick={() => setAnchor(today)}>This week</button>}
          </div>
        </section>

        {loadError && (
          <div className="admin-inline-error" role="alert">
            <p>{loadError}</p><button className="btn btn-secondary" onClick={() => setRefresh((value) => value + 1)}>Retry accounts</button>
          </div>
        )}
        {detailError && !detail && (
          <div className="form-error" role="alert" style={{ marginBottom: "var(--space-3)" }}>
            {detailError}
          </div>
        )}

        <div className="stat-grid admin-stat-grid" aria-busy={!users && !loadError}>
          <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 0 }}>
            <div className="card-kicker">Total users</div>
            <div className="card-title stat-tile-value-lg count-value">{users?.length ?? "—"}</div>
            <p className="admin-stat-caption">Across Wages Tracker</p>
          </div>
          <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 1 }}>
            <div className="card-kicker">Earned in selected weeks</div>
            <div className="card-title stat-tile-value-lg count-value">{users ? adminMoney(totalEarned) : "—"}</div>
            <p className="admin-stat-caption">Wages, fuel & weekly extras · AUD</p>
          </div>
          <div className="card stat-tile anim-rise" style={{ ["--i" as string]: 2 }}>
            <div className="card-kicker">Completed hours</div>
            <div className="card-title stat-tile-value-lg count-value">{users ? totalHours.toFixed(2) : "—"}<small> hrs</small></div>
            <p className="admin-stat-caption">In selected weeks · {totalShifts} shifts all time</p>
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
            <div className="admin-directory-filters"><div className="admin-search-field">
              <label htmlFor="admin-user-search">Search users</label>
              <input
                id="admin-user-search"
                className="input admin-search"
                type="search"
                placeholder="Name or email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div><div className="admin-search-field"><label htmlFor="admin-user-sort">Sort by</label><select id="admin-user-sort" className="input" value={sort} onChange={(event) => setSort(event.target.value)}><option value="earnings">Highest earnings</option><option value="name">Name A–Z</option><option value="shifts">Most shifts</option></select></div></div>
          </div>

          {users === null && !loadError ? (
            <div className="admin-directory-loading" role="status"><div className="admin-skeleton" /><div className="admin-skeleton" /><p>Loading accounts and earnings…</p></div>
          ) : loadError ? null : filtered.length === 0 ? (
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
                    <th>Rate</th>
                    <th>{anchor === today ? "This week" : "Selected week"}</th>
                    <th>Previous week</th>
                    <th>Daily earnings</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u, i) => (
                    <tr key={u.id} style={{ ["--i" as string]: i }}>
                      <td data-label="Name" className="admin-user-name"><div className="admin-user-identity"><span className="admin-user-avatar" aria-hidden="true">{u.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{u.name}</strong><small>{u.workLocationName || "No work location"}</small></div></div></td>
                      <td data-label="Email" className="admin-user-email">{u.email}</td>
                      <td data-label="Rate">
                        {CURRENCY}
                        {fmt2(u.rate)}/hr
                      </td>
                      <td data-label={anchor === today ? "This week" : "Selected week"} className="admin-user-earned"><strong>{u.earnings ? adminMoney(u.earnings.total) : "—"}</strong><small>{u.earnings ? `${u.earnings.hours.toFixed(2)} hrs · ${u.earnings.completedShiftCount} complete` : "Earnings unavailable"}</small><small>{u.earnings ? adminWeekLabel(u.earnings.weekStart, u.earnings.weekEnd) : ""}</small></td>
                      <td data-label="Previous week" className="admin-user-previous"><strong>{u.previousEarnings ? adminMoney(u.previousEarnings.total) : "—"}</strong><small>{u.previousEarnings ? adminWeekLabel(u.previousEarnings.weekStart, u.previousEarnings.weekEnd) : ""}</small></td>
                      <td data-label="Daily earnings" className="admin-user-chart">{u.earnings ? <AdminEarningsChart days={u.earnings.days} label={`${u.name} daily earnings`} compact /> : "—"}</td>
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
        <p className="admin-context-note admin-dashboard-footnote">Overview totals include all accounts. Search filters the directory. Open shifts add no wages; daily bars exclude weekly extras. Open a user to explore their earnings.</p>
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
            <div className="admin-detail-tabs" role="group" aria-label="User detail view"><button className={detailTab === "earnings" ? "is-active" : ""} aria-pressed={detailTab === "earnings"} onClick={() => setDetailTab("earnings")}>Earnings</button><button className={detailTab === "account" ? "is-active" : ""} aria-pressed={detailTab === "account"} onClick={() => setDetailTab("account")}>Account & shifts</button></div>
            {detailTab === "earnings" ? <AdminUserEarnings key={detail.user.id} user={detail.user} initialDate={anchor} onAuthError={onAuthError} /> : <>
            <dl className="admin-detail-summary">
              <div><dt>Email</dt><dd>{detail.user.email}</dd></div>
              <div><dt>Work location</dt><dd>{detail.user.workLocationName || "Not set"}</dd></div>
              <div><dt>Hourly rate</dt><dd>{CURRENCY}{fmt2(detail.user.rate)}/hr</dd></div>
              <div><dt>Weekly goal</dt><dd>{detail.user.goalHours}h · {CURRENCY}{fmt2(detail.user.goalEarnings)}</dd></div>
              <div><dt>Week starts</dt><dd>{detail.user.weekStartsOn}</dd></div>
              <div><dt>Shifts logged</dt><dd>{detail.shifts.length}</dd></div>
              <div><dt>Joined</dt><dd>{fmtDate(detail.user.createdAt)}</dd></div>
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
            </>}
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
