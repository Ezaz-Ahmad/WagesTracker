import { CURRENCY, useApp } from "../context/AppContext";
import { buildWeeklyHistory } from "../lib/aggregate";
import { fmt2 } from "../lib/date";
import { Skeleton } from "../components/Skeleton";
import { Amount } from "../components/Amount";
import { EarningsHiddenHint } from "../components/EarningsHiddenHint";

export function HistoryScreen() {
  const { today, user, shifts, shiftsLoaded, dayExpenses, weekExtras } = useApp();
  if (!user) return null;
  if (!shiftsLoaded) {
    return (
      <div className="screen-narrow screen-transition">
        <h1 className="section-title">History</h1>
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
      <h1 className="section-title">History</h1>
      <div className="section-hint">Completed weeks, most recent first.</div>
      <EarningsHiddenHint className="history-earnings-hint" />
      {rows.length === 0 ? (
        <div className="card anim-rise">
          <p className="card-body" style={{ margin: 0 }}>
            No completed weeks yet — your first full week will show up here once it ends.
          </p>
        </div>
      ) : (
        <table className="table">
          {/* A caption and scope="col" on the header cells: without them a
              screen reader reading cell by cell gets four bare values per
              row with nothing saying which column each belongs to, which on
              a four-column table of numbers is the difference between
              usable and not. The caption repeats the visible hint above
              rather than inventing new wording, and is hidden visually
              because that hint is already on screen. */}
          <caption className="visually-hidden">Completed weeks, most recent first</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Hours</th>
              <th scope="col">Earnings</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={i} style={{ ["--i" as string]: i }}>
                <th scope="row">{w.label}</th>
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
