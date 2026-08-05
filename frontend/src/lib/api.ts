import type { Shift, User, WeekStart } from "./types";

// In local dev this is left unset and Vite's dev-server proxy forwards "/api" to the backend
// (see vite.config.ts). In production, set VITE_API_URL to the deployed backend's origin
// (e.g. https://wage-tracker-api.onrender.com) since the frontend and backend are hosted separately.
const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const TOKEN_KEY = "wageTracker.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}
/** `remember=true` (the default) persists across browser restarts; `false` keeps
 * the session only until the tab/browser closes — the "Remember me" checkbox. */
export function setToken(token: string, remember: boolean = true): void {
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

const REMEMBERED_EMAIL_KEY = "wageTracker.rememberedEmail";

/** The email from the last "Remember me" login — survives logging out and
 * token expiry (until the browser's storage is cleared), so the login form
 * can pre-fill it instead of starting blank every time. */
export function getRememberedEmail(): string | null {
  return localStorage.getItem(REMEMBERED_EMAIL_KEY);
}
export function setRememberedEmail(email: string): void {
  localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
}
export function clearRememberedEmail(): void {
  localStorage.removeItem(REMEMBERED_EMAIL_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((body as { error?: string }).error || `Request failed (${res.status})`, res.status);
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

export function deleteAccount(password: string): Promise<void> {
  return request("/me", { method: "DELETE", body: JSON.stringify({ password }) });
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
