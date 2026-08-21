import type { WeekStart } from "./weekBoundary.js";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  address: string;
  work_location_name: string;
  work_address: string;
  multiple_locations: number;
  other_locations: string;
  week_starts_on: WeekStart;
  rate: number;
  goal_hours: number;
  goal_earnings: number;
  token_version: number;
  created_at: string;
}

export interface PublicUser {
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
  createdAt: string;
}

export interface ShiftRow {
  id: string;
  user_id: string;
  date: string;
  location: string;
  sign_in: string | null;
  sign_out: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicShift {
  id: string;
  date: string;
  location: string;
  signIn: string | null;
  signOut: string | null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    address: row.address,
    workLocationName: row.work_location_name,
    workAddress: row.work_address,
    multipleLocations: !!row.multiple_locations,
    otherLocations: row.other_locations,
    weekStartsOn: row.week_starts_on,
    rate: row.rate,
    goalHours: row.goal_hours,
    goalEarnings: row.goal_earnings,
    createdAt: row.created_at,
  };
}

export function toPublicShift(row: ShiftRow): PublicShift {
  return {
    id: row.id,
    date: row.date,
    location: row.location,
    signIn: row.sign_in,
    signOut: row.sign_out,
  };
}

export interface DayExpenseRow {
  id: string;
  user_id: string;
  date: string;
  fuel_cost: number;
  created_at: string;
  updated_at: string;
}

export interface PublicDayExpense {
  date: string;
  fuelCost: number;
}

export function toPublicDayExpense(row: DayExpenseRow): PublicDayExpense {
  return {
    date: row.date,
    fuelCost: row.fuel_cost,
  };
}

export interface WeekExtraRow {
  id: string;
  user_id: string;
  week_start: string;
  effective_date: string;
  amount: number;
  reason: string;
  created_at: string;
  updated_at: string;
}

export interface PublicWeekExtra {
  weekStart: string;
  amount: number;
  reason: string;
}

export function toPublicWeekExtra(row: WeekExtraRow): PublicWeekExtra {
  return {
    weekStart: row.week_start,
    amount: row.amount,
    reason: row.reason,
  };
}

export interface UserSessionRow {
  id: string;
  user_id: string;
  user_agent: string;
  ip_address: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  /** Null for rows created before installations were tracked, and for
   * clients that don't send one. Never leaves the backend — see
   * toPublicSession below. */
  device_installation_id: string | null;
  device_name: string;
  /** SQLite stores booleans as 0/1 — see toPublicSession's `!!` below.
   * Exempts this session from the idle timeout in validateSession (see
   * security/sessions.ts) — set when the frontend turns biometric login on
   * for this session's device, cleared when it's turned off. */
  biometric_protected: number;
}

export interface PublicSession {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
  biometricProtected: boolean;
}

/** Never include revoked_at, the raw JWT (never stored — see sessions.ts),
 * or anything beyond what a user should see about their own device list. */
export function toPublicSession(row: UserSessionRow, currentSessionId: string): PublicSession {
  return {
    id: row.id,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    lastActiveAt: row.last_seen_at,
    expiresAt: row.expires_at,
    isCurrent: row.id === currentSessionId,
    biometricProtected: !!row.biometric_protected,
  };
}

export interface AdminUserSummary extends PublicUser {
  shiftCount: number;
}

export function toAdminUserSummary(row: UserRow & { shift_count: unknown }): AdminUserSummary {
  return {
    ...toPublicUser(row),
    shiftCount: Number(row.shift_count ?? 0),
  };
}
