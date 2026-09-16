import type { WeekSummary } from "../lib/aggregate";
import { isoDate, parseIsoDate } from "../lib/date";

export interface HistoryDateRange {
  from: string;
  to: string;
}

function monthRange(today: Date, offset: number): HistoryDateRange {
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const last = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  return { from: isoDate(first), to: isoDate(last) };
}

export function currentMonthRange(today: Date): HistoryDateRange {
  return monthRange(today, 0);
}

export function previousMonthRange(today: Date): HistoryDateRange {
  return monthRange(today, -1);
}

export function recentThreeMonthsRange(today: Date): HistoryDateRange {
  return {
    from: isoDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
    to: isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

export function rangesEqual(left: HistoryDateRange, right: HistoryDateRange): boolean {
  return left.from === right.from && left.to === right.to;
}

/** Weekly PDFs are included when any day in the week intersects the filter. */
export function weekOverlapsRange(week: WeekSummary, range: HistoryDateRange): boolean {
  return week.endISO >= range.from && week.startISO <= range.to;
}

export function formatHistoryDateRange(range: HistoryDateRange): string {
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  const isWholeMonth =
    from.getDate() === 1 &&
    to.getFullYear() === from.getFullYear() &&
    to.getMonth() === from.getMonth() &&
    to.getDate() === new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();

  if (isWholeMonth) {
    return from.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const shortDate = (date: Date, includeYear: boolean) => date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
  if (from.getFullYear() === to.getFullYear()) {
    if (from.getMonth() === to.getMonth()) {
      return `${from.toLocaleDateString("en-US", { month: "short" })} ${from.getDate()}–${to.getDate()}, ${to.getFullYear()}`;
    }
    return `${shortDate(from, false)} – ${shortDate(to, true)}`;
  }
  return `${shortDate(from, true)} – ${shortDate(to, true)}`;
}
