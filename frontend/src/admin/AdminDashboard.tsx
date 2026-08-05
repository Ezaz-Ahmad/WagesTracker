import { useEffect, useMemo, useState } from "react";
import type { Shift, User } from "../lib/types";
import { AdminApiError, deleteUser, fetchAllUsers, fetchUserDetail, type AdminUserSummary } from "./adminApi";

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

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteUser(deleteTarget.id);
      setUsers((prev) => (prev ? prev.filter((u) => u.id !== deleteTarget.id) : prev));
      setDeleteTarget(null);
      setDeleteConfirmText("");
    } catch (e) {
      if (onAuthError(e)) return;
      setDeleteError(e instanceof AdminApiError ? e.message : "Couldn't delete user");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="admin-shell">
      <div className="nav admin-nav">
        <span className="nav-brand">Wage Tracker — Admin</span>
        <button className="btn btn-secondary" onClick={onLogout}>
          Log out
        </button>
      </div>

      <div className="admin-frame screen-transition">
        {loadError && (
          <div className="form-error" style={{ marginBottom: "var(--space-3)" }}>
            {loadError}
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
          <h6 className="section-title" style={{ margin: 0 }}>
            All users
          </h6>
          <input
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
                  <th></th>
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
                      <button className="btn btn-ghost" onClick={() => handleView(u)} disabled={detailLoadingId === u.id}>
                        {detailLoadingId === u.id ? "Loading…" : "View"}
                      </button>
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
      </div>

      {detail && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setDetail(null);
            setDetailError(null);
          }}
        >
          <div className="dialog admin-detail-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{detail.user.name}</div>
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
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setDetail(null);
                  setDetailError(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="dialog-backdrop" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Delete {deleteTarget.name}?</div>
            <p className="dialog-body">
              This permanently deletes this user's account and all {deleteTarget.shiftCount} logged shift
              {deleteTarget.shiftCount === 1 ? "" : "s"}. There's no way to undo this. Type{" "}
              <strong>{deleteTarget.email}</strong> to confirm.
            </p>
            {deleteError && <div className="form-error">{deleteError}</div>}
            <div className="field">
              <label>Confirm email</label>
              <input
                className="input"
                type="text"
                autoFocus
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting || deleteConfirmText.trim().toLowerCase() !== deleteTarget.email.toLowerCase()}
              >
                {deleting ? "Deleting…" : "Delete user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
