export const WEEK_DAYS: readonly [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export type WeekStart = (typeof WEEK_DAYS)[number];

export function isWeekStart(value: unknown): value is WeekStart;
export function weekDayIndex(weekStartsOn: WeekStart): number;
export function addIsoDays(isoDate: string, days: number): string;
export function startOfWeekISO(isoDate: string, weekStartsOn: WeekStart): string;
export function weekRangeISO(isoDate: string, weekStartsOn: WeekStart): { start: string; end: string };
export function weekEndDay(weekStartsOn: WeekStart): WeekStart;
