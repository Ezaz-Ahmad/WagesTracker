export type WeekStart = "Monday" | "Sunday";

export interface User {
  id: string;
  name: string;
  email: string;
  workLocationName: string;
  workAddress: string;
  multipleLocations: boolean;
  otherLocations: string;
  weekStartsOn: WeekStart;
  rate: number;
  goalHours: number;
  goalEarnings: number;
  createdAt: string;
}

export interface Shift {
  id: string;
  date: string; // YYYY-MM-DD
  location: string;
  signIn: string | null; // HH:MM
  signOut: string | null; // HH:MM
}

// One per calendar day (not per shift) — a day can have multiple shifts but
// only ever one fuel cost entry, upserted/cleared by date.
export interface DayExpense {
  date: string; // YYYY-MM-DD
  fuelCost: number;
}

// One per week (identified by that week's start date, per the user's
// weekStartsOn setting) — a single lump amount like a tip, bonus, or
// reimbursement, always paired with a reason.
export interface WeekExtra {
  weekStart: string; // YYYY-MM-DD
  amount: number;
  reason: string;
}

export type Screen = "home" | "entry" | "report" | "history" | "settings";
