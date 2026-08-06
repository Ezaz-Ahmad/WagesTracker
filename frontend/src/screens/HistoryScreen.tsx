import { CURRENCY, useApp } from "../context/AppContext";
import { buildWeeklyHistory } from "../lib/aggregate";
import { fmt2 } from "../lib/date";
import { Skeleton } from "../components/Skeleton";
import { Amount } from "../components/Amount";

export function HistoryScreen() {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras } = useApp();
  if (!user) return null;
  if (!shiftsLoaded) {
    return (
      <div className="screen-narrow screen-transition">
        <h6 className="section-title">History</h6>
        <Skeleton className="skeleton-row" />
        <Skeleton className="skeleton-row" />
        <Skeleton className="skeleton-row" />
      </div>
    );
  }

  const history = buildWeeklyHistory(shifts, today, user.weekStartsOn, user.rate, 20, new Date(user.createdAt), dayExpenses, weekExtras);
  const rows = history
    .slice()
    .reverse()
    .map((w) => {
      const met = w.earnings >= user.goalEarnings;
      return {
        label: w.label,
        hoursLabel: `${fmt2(w.hours)}h`,
        earningsLabel: CURRENCY + fmt2(w.earnings),
        tagClass: met ? "tag-accent" : "tag-neutral",
        tagLabel: met ? "Met goal" : "Under goal",
      };
    });

  return (
    <div className="screen-narrow">
      <h6 className="section-title">History</h6>
      <div className="section-hint">Completed weeks, most recent first.</div>
      {rows.length === 0 ? (
        <div className="card anim-rise">
          <p className="card-body" style={{ margin: 0 }}>
            No completed weeks yet — your first full week will show up here once it ends.
          </p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Hours</th>
              <th>Earnings</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={i} style={{ ["--i" as string]: i }}>
                <td>{w.label}</td>
                <td>{w.hoursLabel}</td>
                <td>
                  <Amount>{w.earningsLabel}</Amount>
                </td>
                <td>
                  <span className={`tag ${w.tagClass}`}>{w.tagLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
