import type { WeekStart } from "./weekBoundary.mjs";

export type { WeekStart };

export interface User {
  workspacesEnabled?:boolean;
  combinedGoalEarnings?: number;
  id: string;
  name: string;
  email: string;
  address: string;
  workLocationName: string;
  workAddress: string;
  multipleLocations: boolean;
  otherLocations: string;
  weekStartsOn: WeekStart;
  rate: number;
  goalHours: number;
  goalEarnings: number;
  /** Account-level opt-in. Optional for a safe rolling backend deployment. */
  smartRemindersEnabled?: boolean;
  createdAt: string;
}

export interface Shift {
  appliedRate?: number | null;
  rateSource?: string | null;
  jobName?: string | null;
  jobId?: string;
  id: string;
  date: string; // YYYY-MM-DD
  location: string;
  workLocationId?: string | null;
  fuelAllowanceSnapshot?: number | null;
  signIn: string | null; // HH:MM
  signOut: string | null; // HH:MM
  /** False for historical/manual entries or shifts whose times were edited. */
}

// One per calendar day (not per shift) — a day can have multiple shifts but
// only ever one fuel cost entry, upserted/cleared by date.
export interface DayExpense {
  jobId?: string;
  date: string; // YYYY-MM-DD
  fuelCost: number;
  automaticFuelAllowance?: number;
  manualOverride?: number | null;
  source?: "automatic" | "manual";
}

export interface WorkLocation {
  hourlyRate?: number;
  rateSource?: string;
  jobId?: string;
  id: string;
  name: string;
  address: string;
  fuelAllowance: number | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// One per week (identified by that week's start date, per the user's
// weekStartsOn setting) — a single lump amount like a tip, bonus, or
// reimbursement, always paired with a reason.
export interface WeekExtra {
  effectiveDate?:string;
  jobId?: string;
  weekStart: string; // YYYY-MM-DD
  amount: number;
  reason: string;
}

export type SpendingIcon =
  | "dining" | "groceries" | "transport" | "housing" | "bills" | "shopping"
  | "health" | "entertainment" | "education" | "family" | "other";

export type SpendingColour =
  | "#B45309" | "#047857" | "#1D4ED8" | "#7C3AED" | "#0E7490" | "#BE123C"
  | "#9F1239" | "#6D28D9" | "#0369A1" | "#A16207" | "#475569";

export type PaymentMethod = "card" | "cash" | "bank_transfer" | "other";

export interface SpendingCategory {
  id: string;
  name: string;
  icon: SpendingIcon;
  colour: SpendingColour;
  isDefault: boolean;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCategoryRef {
  id: string;
  name: string;
  icon: SpendingIcon;
  colour: SpendingColour;
  archived: boolean;
}

export interface PersonalExpense {
  jobId?:string|null;
  id: string;
  amountCents: number;
  categoryId: string;
  spentAt: string;
  spentDate: string;
  timeZone: string;
  merchant: string;
  note: string;
  paymentMethod: PaymentMethod | null;
  createdAt: string;
  updatedAt: string;
  category: ExpenseCategoryRef;
}

export interface SpendingSummary {
  period: { from: string; to: string; previousFrom: string; previousTo: string; days: number };
  earningsCents: number;
  earningsRecorded: boolean;
  totalSpendingCents: number;
  differenceCents: number;
  spendingPercentage: number | null;
  averageDailyCents: number;
  transactionCount: number;
  largestCategory: SpendingCategoryTotal | null;
  previous: { earningsCents: number; totalSpendingCents: number; spendingChangePercent: number | null };
  categories: SpendingCategoryTotal[];
  trend: { date: string; totalCents: number }[];
  recentExpenses: PersonalExpense[];
}

export interface SpendingCategoryTotal {
  id: string;
  name: string;
  icon: SpendingIcon;
  colour: SpendingColour;
  totalCents: number;
  transactionCount: number;
}

export type Screen = "home" | "entry" | "spending" | "report" | "history" | "settings";

export interface Job {id:string;name:string;role:string;weekStartsOn:WeekStart;rate:number;goalHours:number;goalEarnings:number;smartRemindersEnabled:boolean;isPrimary:boolean;archived:boolean;createdAt:string;}
export interface PayRate {id:string;jobId:string;locationId:string|null;effectiveFrom:string;rate:number|null;createdAt:string;}
