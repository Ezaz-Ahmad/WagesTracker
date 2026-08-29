import { useEffect, useMemo, useState } from "react";
import type { Shift, User } from "../lib/types";
import { AdminApiError, deleteUser, fetchAllUsers, fetchUserDetail, type AdminUserSummary } from "./adminApi";
import { Logo } from "../components/Logo";
import { Overlay } from "../components/Overlay";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";
import { AsyncButton } from "../components/AsyncButton";

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
    } catch (e) {
      if (onAuthError(e)) return;
      setDetailError(e instanceof AdminApiError ? e.message : "Couldn't load user");
    } finally {
      setDetailLoadingId(null);
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
        <span className="nav-brand">
          <Logo size={20} />
          Wage Tracker — Admin
        </span>
        <button className="btn btn-secondary" onClick={onLogout}>
          Log out
        </button>
      </header>

      <main className="admin-frame screen-transition">
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
        </div>

        <div className="row-baseline admin-toolbar">
          <h1 className="section-title" style={{ margin: 0 }}>
            All users
          </h1>
          <label className="sr-only" htmlFor="admin-user-search">Search users</label>
          <input
            id="admin-user-search"
            className="input admin-search"
            type="text"
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {users === null && !loadError ? (
          <div className="section-hint">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="card anim-rise">
            <p className="card-body" style={{ margin: 0 }}>
              {users && users.length > 0 ? "No users match your search." : "No users yet."}
            </p>
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
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.workLocationName || "—"}</td>
                    <td>
                      {CURRENCY}
                      {fmt2(u.rate)}/hr
                    </td>
                    <td>
                      {u.goalHours}h · {CURRENCY}
                      {fmt2(u.goalEarnings)}
                    </td>
                    <td>{u.shiftCount}</td>
                    <td>{fmtDate(u.createdAt)}</td>
                    <td className="admin-row-actions">
                      <AsyncButton className="btn btn-ghost" onClick={() => handleView(u)} busy={detailLoadingId === u.id} idleLabel="View" busyLabel="Loading…" />
                      <button className="btn btn-danger" onClick={() => openDeleteDialog(u)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
            <h2 className="dialog-title" id="admin-user-detail-title">{detail.user.name}</h2>
            <p className="dialog-body" style={{ margin: 0 }}>
              {detail.user.email} · {detail.user.workLocationName || "No work location set"}
              <br />
              {CURRENCY}
              {fmt2(detail.user.rate)}/hr · goal {detail.user.goalHours}h · {CURRENCY}
              {fmt2(detail.user.goalEarnings)}/week · week starts {detail.user.weekStartsOn}
            </p>
            {detailError && <div className="form-error">{detailError}</div>}
            <div className="admin-detail-shifts">
              {detail.shifts.length === 0 ? (
                <p className="card-body">No shifts logged.</p>
              ) : (
                <table className="table">
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
                        <td>{s.date}</td>
                        <td>{s.location || "—"}</td>
                        <td>{s.signIn ?? "—"}</td>
                        <td>{s.signOut ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              This permanently deletes this user's profile, settings, sessions, shifts, expenses, and spending
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
