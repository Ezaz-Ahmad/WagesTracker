import type { User, WeekStart } from "../../lib/types";
import { addIsoDays, startOfWeekISO } from "../../lib/weekBoundary.mjs";
import type { AdminUserEarnings, AdminWeekEarnings } from "../adminApi";

export const ADMIN_TEST_USER: User = {
  id: "user-1",
  name: "Long Test User",
  email: "test@example.com",
  address: "1 Home Street",
  workLocationName: "Central Store",
  workAddress: "1 Main Street",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 28.5,
  goalHours: 35,
  goalEarnings: 500,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export function makeEarningsWeek(weekStart: string, values: {
  wages?: number;
  fuel?: number;
  extras?: number;
  hours?: number;
  openShiftCount?: number;
} = {}): AdminWeekEarnings {
  const { wages = 228, fuel = 12, extras = 25, hours = 8, openShiftCount = 1 } = values;
  const completedShiftCount = hours > 0 ? 1 : 0;
  return {
    weekStart,
    weekEnd: addIsoDays(weekStart, 6),
    hours,
    wages,
    fuel,
    extras,
    total: wages + fuel + extras,
    shiftCount: completedShiftCount + openShiftCount,
    completedShiftCount,
    openShiftCount,
    days: Array.from({ length: 7 }, (_, index) => ({
      date: addIsoDays(weekStart, index),
      hours: index === 0 ? hours : 0,
      wages: index === 0 ? wages : 0,
      fuel: index === 0 ? fuel : 0,
      total: index === 0 ? wages + fuel : 0,
      shiftCount: index === 0 ? completedShiftCount : index === 2 ? openShiftCount : 0,
      openShiftCount: index === 2 ? openShiftCount : 0,
    })),
  };
}

export function makeUserEarnings(date: string, weekStartsOn: WeekStart = "Monday"): AdminUserEarnings {
  const start = startOfWeekISO(date, weekStartsOn);
  return {
    week: makeEarningsWeek(start),
    previousWeek: makeEarningsWeek(addIsoDays(start, -7), { wages: 171, fuel: 9, extras: 20, hours: 6, openShiftCount: 0 }),
    availableWeeks: [start, addIsoDays(start, -7), addIsoDays(start, -14)],
  };
}
