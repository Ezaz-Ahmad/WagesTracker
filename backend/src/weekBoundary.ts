// The API and frontend intentionally execute this exact same implementation.
// Keeping plain-calendar week arithmetic in one platform-neutral module avoids
// browser/server time-zone drift and prevents separate screen-specific rules.
export {
  WEEK_DAYS,
  addIsoDays,
  isWeekStart,
  startOfWeekISO,
  weekDayIndex,
  weekEndDay,
  weekRangeISO,
} from "../../frontend/src/lib/weekBoundary.mjs";
export type { WeekStart } from "../../frontend/src/lib/weekBoundary.mjs";
