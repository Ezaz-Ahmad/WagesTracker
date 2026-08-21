/**
 * Platform-neutral calendar-week rules shared by the React app and API.
 *
 * All functions operate on plain YYYY-MM-DD calendar dates. UTC is used only
 * as an arithmetic container, so daylight-saving and server time zones can
 * never move a boundary onto a neighbouring date.
 */
export const WEEK_DAYS = Object.freeze([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

const JS_DAY_INDEX = Object.freeze({
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
});

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parseIsoDateParts(isoDate) {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match) throw new RangeError(`Invalid calendar date: ${isoDate}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${isoDate}`);
  }
  return value;
}

function formatUtcDate(value) {
  return value.toISOString().slice(0, 10);
}

export function isWeekStart(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(JS_DAY_INDEX, value);
}

export function weekDayIndex(weekStartsOn) {
  if (!isWeekStart(weekStartsOn)) throw new RangeError(`Invalid week-start day: ${weekStartsOn}`);
  return JS_DAY_INDEX[weekStartsOn];
}

export function addIsoDays(isoDate, days) {
  if (!Number.isInteger(days)) throw new RangeError("Day offset must be an integer");
  const value = parseIsoDateParts(isoDate);
  value.setUTCDate(value.getUTCDate() + days);
  return formatUtcDate(value);
}

export function startOfWeekISO(isoDate, weekStartsOn) {
  const value = parseIsoDateParts(isoDate);
  const difference = (value.getUTCDay() - weekDayIndex(weekStartsOn) + 7) % 7;
  return addIsoDays(isoDate, -difference);
}

export function weekRangeISO(isoDate, weekStartsOn) {
  const start = startOfWeekISO(isoDate, weekStartsOn);
  return { start, end: addIsoDays(start, 6) };
}

export function weekEndDay(weekStartsOn) {
  const startIndex = WEEK_DAYS.indexOf(weekStartsOn);
  if (startIndex < 0) throw new RangeError(`Invalid week-start day: ${weekStartsOn}`);
  return WEEK_DAYS[(startIndex + 6) % 7];
}
