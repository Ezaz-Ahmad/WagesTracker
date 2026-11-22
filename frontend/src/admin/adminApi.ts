import type { Job,PayRate,WorkLocation } from "../lib/types";
import type { Shift, User, WeekStart } from "../lib/types";
import { showErrorPopup } from "../lib/errorFeedback";
import { feedbackForApiError } from "../lib/apiErrorFeedback";
import { toUserFacingError } from "../lib/userFacingError";
import { RequestTimeoutError, withRequestTimeout } from "../lib/networkRequest";

// Deliberately separate from lib/api.ts: a different token, a different storage key, and a
// different base path (/api/admin), so an admin session and a regular user session on the
// same browser never collide or share state.
const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const ADMIN_TOKEN_KEY = "wageTracker.adminToken";
let memoryToken: string | null = null;
let memoryOnly = false;

export function getAdminToken(): string | null {
  if (memoryOnly) return memoryToken;
  try { return localStorage.getItem(ADMIN_TOKEN_KEY); }
  catch { memoryOnly = true; return memoryToken; }
}
export function setAdminToken(token: string): void {
  memoryToken = token;
  try { localStorage.setItem(ADMIN_TOKEN_KEY, token); memoryOnly = false; }
  catch { memoryOnly = true; }
}
export function clearAdminToken(): void {
  memoryToken = null;
  try { localStorage.removeItem(ADMIN_TOKEN_KEY); memoryOnly = false; }
  catch { memoryOnly = true; }
}

export class AdminApiError extends Error {
  status: number;
  code?: string;
  field?: string;
  suggestion?: string;
  constructor(message: string, status: number, code?: string, field?: string, suggestion?: string) {
    super(message);
    this.status = status;
    this.code = typeof code === "string" ? code : undefined;
    this.field = typeof field === "string" ? field : undefined;
    this.suggestion = typeof suggestion === "string" ? suggestion : undefined;
  }
}

function reportAdminError(error: AdminApiError): AdminApiError {
  showErrorPopup(feedbackForApiError(error));
  return error;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  try { return await withRequestTimeout(async signal => {
  const token = getAdminToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Client-Time-Zone":Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/admin${path}`, {
      ...options,
      signal,
      headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw reportAdminError(new AdminApiError("Couldn't connect to Wages Tracker. Check your internet connection and try again.", 0));
  }
  if (res.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await res.json();
    if (body === null || typeof body !== "object") { if (res.ok) throw new Error("Missing response data"); body = {}; }
  } catch (error) {
    if (signal.aborted) throw error;
    if (res.ok) throw reportAdminError(new AdminApiError("Wages Tracker returned an incomplete response. Refresh and try again.", 502, "INVALID_RESPONSE"));
    body = {};
  }
  if (!res.ok) {
    const payload = body as { error?: string; code?: string; field?: string; suggestion?: string };
    throw reportAdminError(new AdminApiError(toUserFacingError(payload.error || `Request failed (${res.status})`, res.status), res.status, payload.code, payload.field, payload.suggestion));
  }
  return body as T;
  }, { signal: options.signal }); }
  catch (error) {
    if (error instanceof RequestTimeoutError) throw reportAdminError(new AdminApiError("We couldn't confirm the result in time. Refresh to check it before trying again.", 0, "REQUEST_TIMEOUT"));
    throw error;
  }
}

export interface AdminUserSummary {
  jobCount?:number;activeJobCount?:number;
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
  shiftCount: number;
  earnings: AdminWeekEarnings;
  previousEarnings: AdminWeekEarnings;
}

export interface AdminEarningsDay {
  date: string;
  hours: number;
  wages: number;
  fuel: number;
  total: number;
  shiftCount: number;
  openShiftCount: number;
}

export interface AdminWeekEarnings {
  weekStart: string;
  weekEnd: string;
  hours: number;
  wages: number;
  fuel: number;
  extras: number;
  total: number;
  shiftCount: number;
  completedShiftCount: number;
  openShiftCount: number;
  days: AdminEarningsDay[];
}

export interface AdminUserEarnings {
  jobs?: (Job & {earnings?:AdminWeekEarnings})[];weekStartsOn?:WeekStart;
  week: AdminWeekEarnings;
  previousWeek: AdminWeekEarnings;
  availableWeeks: string[];
}

export function adminLogin(password: string): Promise<{ token: string }> {
  return request("/login", { method: "POST", body: JSON.stringify({ password }) });
}

export function fetchAllUsers(date?: string): Promise<{ users: AdminUserSummary[] }> {
  return request(`/users${date ? `?date=${encodeURIComponent(date)}` : ""}`);
}

export function fetchUserDetail(id: string): Promise<{ user: User; shifts: Shift[];jobs?:Job[];locations?:WorkLocation[];rates?:PayRate[] }> {
  return request(`/users/${id}`);
}

export function fetchUserEarnings(id: string, date: string,jobId?:string): Promise<AdminUserEarnings> {
  return request(`/users/${encodeURIComponent(id)}/earnings?date=${encodeURIComponent(date)}${jobId&&jobId!=="all"?`&jobId=${encodeURIComponent(jobId)}`:""}`);
}

export function deleteUser(id: string): Promise<void> {
  return request(`/users/${id}`, { method: "DELETE" });
}

export function updateUserEmail(
  id: string,
  email: string,
  acceptEmailAsEntered = false
): Promise<{ user: User; message: string }> {
  return request(`/users/${id}/email`, {
    method: "PATCH",
    body: JSON.stringify({ email, acceptEmailAsEntered }),
  });
}
