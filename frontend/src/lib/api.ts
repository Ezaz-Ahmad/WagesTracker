import type { Shift, User, WeekStart } from "./types";

const TOKEN_KEY = "wageTracker.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers: { ...headers, ...(options.headers as Record<string, string> | undefined) } });
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return body as T;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  workLocationName: string;
  workAddress: string;
  multipleLocations: boolean;
  otherLocations: string;
}

export function signup(input: SignupInput): Promise<{ token: string; user: User }> {
  return request("/auth/signup", { method: "POST", body: JSON.stringify(input) });
}

export function login(email: string, password: string): Promise<{ token: string; user: User }> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function fetchMe(): Promise<{ user: User }> {
  return request("/me");
}

export interface MePatch {
  name?: string;
  workLocationName?: string;
  workAddress?: string;
  multipleLocations?: boolean;
  otherLocations?: string;
  weekStartsOn?: WeekStart;
  rate?: number;
  goalHours?: number;
  goalEarnings?: number;
}

export function patchMe(patch: MePatch): Promise<{ user: User }> {
  return request("/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export function listShifts(from: string, to: string): Promise<{ shifts: Shift[] }> {
  return request(`/shifts?from=${from}&to=${to}`);
}

export interface ShiftInput {
  date: string;
  location: string;
  signIn: string | null;
  signOut: string | null;
}

export function createShift(input: ShiftInput): Promise<{ shift: Shift }> {
  return request("/shifts", { method: "POST", body: JSON.stringify(input) });
}

export function patchShift(id: string, patch: Partial<ShiftInput>): Promise<{ shift: Shift }> {
  return request(`/shifts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteShift(id: string): Promise<void> {
  return request(`/shifts/${id}`, { method: "DELETE" });
}
