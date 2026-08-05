import { CURRENCY, useApp } from "../context/AppContext";
import { buildWeeklyHistory } from "../lib/aggregate";
import { fmt2 } from "../lib/date";

export function HistoryScreen() {
  const { today, user, shifts } = useApp();
  if (!user) return null;

  const history = buildWeeklyHistory(shifts, today, user.weekStartsOn, user.rate, 20);
  const rows = history
    .slice()
    .reverse()
    .map((w) => {
      const met = w.earnings >= user.goalEarnings;
      return {
        label: w.label,
        hoursLabel: `${w.hours}h`,
        earningsLabel: CURRENCY + fmt2(w.earnings),
        tagClass: met ? "tag-accent" : "tag-neutral",
        tagLabel: met ? "Met goal" : "Under goal",
      };
    });

  return (
    <>
      <h6 className="section-title">History</h6>
      <div className="section-hint">Completed weeks, most recent first.</div>
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
              <td>{w.earningsLabel}</td>
              <td>
                <span className={`tag ${w.tagClass}`}>{w.tagLabel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
