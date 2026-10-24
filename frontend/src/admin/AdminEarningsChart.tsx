import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useChartReveal } from "../lib/useChartReveal";
import "./AdminEarningsChart.css";

export type AdminEarningsDay = {
  date: string;
  hours: number;
  wages: number;
  fuel: number;
  total: number;
  shiftCount: number;
  openShiftCount: number;
};

type AdminEarningsChartProps = {
  days: readonly AdminEarningsDay[];
  previousDays?: readonly AdminEarningsDay[];
  label?: string;
  compact?: boolean;
};

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const axisMoney = new Intl.NumberFormat("en-AU", {
  style: "currency", currency: "AUD", notation: "compact", maximumFractionDigits: 1,
});
const hours = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });
const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "short" });
const fullDate = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "short" });

function dateLabel(date: string, full = false) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : (full ? fullDate : weekday).format(parsed);
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function dayDescription(day: AdminEarningsDay, previous?: AdminEarningsDay) {
  const previousLabel = previous ? ` Previous week: ${money.format(finite(previous.total))}.` : "";
  const openLabel = day.openShiftCount > 0
    ? ` ${day.openShiftCount} open ${day.openShiftCount === 1 ? "shift" : "shifts"}, with earnings still in progress.`
    : "";
  return `${dateLabel(day.date, true)}: ${money.format(finite(day.total))} total, `
    + `${money.format(finite(day.wages))} wages, ${money.format(finite(day.fuel))} fuel, `
    + `${hours.format(finite(day.hours))} hours, ${day.shiftCount} ${day.shiftCount === 1 ? "shift" : "shifts"}.`
    + openLabel + previousLabel;
}

/** Daily figures are shift earnings only; weekly adjustments belong in the summary. */
export function AdminEarningsChart({
  days,
  previousDays,
  label = "Daily earnings",
  compact = false,
}: AdminEarningsChartProps) {
  const id = useId();
  const reveal = useChartReveal<HTMLElement>();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const peakIndex = days.reduce((best, day, index) => finite(day.total) > finite(days[best]?.total ?? 0) ? index : best, 0);
  const selectedIndex = Math.max(0, days.findIndex((day) => day.date === selectedDate));
  const stableIndex = selectedDate !== null && days.some((day) => day.date === selectedDate) ? selectedIndex : peakIndex;
  const hoveredIndex = days.findIndex((day) => day.date === hoveredDate);
  const activeIndex = hoveredIndex >= 0 ? hoveredIndex : stableIndex;
  const activeDay = days[activeIndex];
  const previousDay = previousDays?.[activeIndex];
  const total = days.reduce((sum, day) => sum + finite(day.total), 0);
  const maximum = Math.max(1, ...days.map((day) => finite(day.total)), ...(previousDays ?? []).map((day) => finite(day.total)));
  const noEarnings = days.every((day) => finite(day.total) === 0);
  const chartStyle = { "--admin-chart-columns": Math.max(1, days.length) } as CSSProperties;

  function barStyle(day: AdminEarningsDay, index: number): CSSProperties {
    return {
      height: `${Math.max(0, finite(day.total)) / maximum * 100}%`,
      "--admin-chart-delay": `${Math.min(index, 6) * 45}ms`,
    } as CSSProperties;
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % days.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + days.length) % days.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = days.length - 1;
    else return;
    event.preventDefault();
    setHoveredDate(null);
    setSelectedDate(days[next].date);
    buttons.current[next]?.focus();
  }

  const stack = (day: AdminEarningsDay, index: number) => {
    const wages = Math.max(0, finite(day.wages));
    const fuel = Math.max(0, finite(day.fuel));
    const stackTotal = wages + fuel;
    return (
      <span className={`admin-earnings-chart-stack${finite(day.total) === 0 ? " is-zero" : ""}`} style={barStyle(day, index)}>
        <span className="admin-earnings-chart-fuel" style={{ flexGrow: stackTotal > 0 ? fuel / stackTotal : 0 }} />
        <span className="admin-earnings-chart-wages" style={{ flexGrow: stackTotal > 0 ? wages / stackTotal : 1 }} />
      </span>
    );
  };

  if (compact) {
    return (
      <div
        className={`admin-earnings-chart admin-earnings-chart-compact ${reveal.revealClassName}${noEarnings ? " is-empty" : ""}`}
        ref={reveal.ref}
        role="img"
        aria-label={`${label}: ${money.format(total)} in daily shift earnings.${noEarnings ? " No earnings recorded." : ""}`}
        style={chartStyle}
      >
        <div className="admin-earnings-chart-mini-bars" aria-hidden="true">
          {days.map((day, index) => <span className="admin-earnings-chart-mini-column" key={day.date}>{stack(day, index)}</span>)}
        </div>
      </div>
    );
  }

  return (
    <figure className={`admin-earnings-chart ${reveal.revealClassName}`} ref={reveal.ref} style={chartStyle} aria-labelledby={`${id}-caption`}>
      <figcaption className="admin-earnings-chart-heading" id={`${id}-caption`}>
        <strong>{label}</strong>
        <span className="admin-earnings-chart-legend">
          <span><i className="admin-earnings-chart-key-wages" aria-hidden="true" />Wages</span>
          <span><i className="admin-earnings-chart-key-fuel" aria-hidden="true" />Fuel</span>
          {previousDays && <span><i className="admin-earnings-chart-key-previous" aria-hidden="true" />Previous week</span>}
        </span>
      </figcaption>
      <p className="admin-earnings-chart-hint" id={`${id}-hint`}>Select a day for exact figures. Use arrow keys to move between days.</p>
      {days.length === 0 ? <p className="admin-earnings-chart-empty">No daily earnings to display for this week.</p> : (
        <>
          <div className="admin-earnings-chart-plot" key={days[0].date}>
            <div className="admin-earnings-chart-axis" aria-hidden="true">
              <span>{axisMoney.format(maximum)}</span><span>{axisMoney.format(maximum / 2)}</span><span>$0</span>
            </div>
            <div className="admin-earnings-chart-bars" role="group" aria-label={`${label} by day`} aria-describedby={`${id}-hint`} onPointerLeave={() => setHoveredDate(null)}>
              <div className="admin-earnings-chart-grid" aria-hidden="true"><i /><i /><i /></div>
              {days.map((day, index) => (
                <button
                  key={day.date}
                  type="button"
                  className={`admin-earnings-chart-day${index === activeIndex ? " is-active" : ""}`}
                  ref={(node) => { buttons.current[index] = node; }}
                  tabIndex={index === stableIndex ? 0 : -1}
                  aria-label={dayDescription(day, previousDays?.[index])}
                  aria-pressed={index === stableIndex}
                  onClick={() => { setHoveredDate(null); setSelectedDate(day.date); }}
                  onFocus={() => { setHoveredDate(null); setSelectedDate(day.date); }}
                  onPointerEnter={(event) => { if (event.pointerType !== "touch") setHoveredDate(day.date); }}
                  onKeyDown={(event) => navigate(event, index)}
                >
                  <span className="admin-earnings-chart-column" aria-hidden="true">
                    {previousDays?.[index] && <span className="admin-earnings-chart-previous" style={barStyle(previousDays[index], index)} />}
                    {stack(day, index)}
                  </span>
                  <span className="admin-earnings-chart-day-label" aria-hidden="true">{dateLabel(day.date)}</span>
                  <span className="admin-earnings-chart-day-date" aria-hidden="true">{Number(day.date.slice(-2)) || ""}</span>
                </button>
              ))}
            </div>
          </div>
          {noEarnings && <p className="admin-earnings-chart-zero">No shift earnings recorded this week yet.</p>}
          {activeDay && (
            <div className="admin-earnings-chart-detail" role="status" aria-live="polite" aria-atomic="true">
              <div className="admin-earnings-chart-detail-heading">
                <div><strong>{dateLabel(activeDay.date, true)}</strong><span>{activeDay.shiftCount} {activeDay.shiftCount === 1 ? "shift" : "shifts"} · {hours.format(finite(activeDay.hours))} hours</span></div>
                <strong className="admin-earnings-chart-detail-total">{money.format(finite(activeDay.total))}</strong>
              </div>
              <div className="admin-earnings-chart-detail-breakdown"><span>Wages <b>{money.format(finite(activeDay.wages))}</b></span><span>Fuel <b>{money.format(finite(activeDay.fuel))}</b></span>{previousDay && <span>Previous week <b>{money.format(finite(previousDay.total))}</b></span>}</div>
              {activeDay.openShiftCount > 0 && <p className="admin-earnings-chart-open">{activeDay.openShiftCount} open {activeDay.openShiftCount === 1 ? "shift" : "shifts"} · Earnings are still in progress.</p>}
            </div>
          )}
          <details className="admin-earnings-chart-data">
            <summary>View daily figures</summary>
            <div className="admin-earnings-chart-data-scroll">
              <table>
                <caption>{label}: exact daily shift figures</caption>
                <thead><tr><th scope="col">Day</th><th scope="col">Shifts</th><th scope="col">Hours</th><th scope="col">Wages</th><th scope="col">Fuel</th><th scope="col">Total</th>{previousDays && <th scope="col">Previous week</th>}</tr></thead>
                <tbody>{days.map((day, index) => <tr key={day.date}><th scope="row">{dateLabel(day.date, true)}</th><td>{day.shiftCount}{day.openShiftCount > 0 ? ` (${day.openShiftCount} open)` : ""}</td><td>{hours.format(finite(day.hours))}</td><td>{money.format(finite(day.wages))}</td><td>{money.format(finite(day.fuel))}</td><td>{money.format(finite(day.total))}</td>{previousDays && <td>{previousDays[index] ? money.format(finite(previousDays[index].total)) : "—"}</td>}</tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </figure>
  );
}
