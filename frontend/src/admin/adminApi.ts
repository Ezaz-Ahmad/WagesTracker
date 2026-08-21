import type { Shift, User, WeekStart } from "../lib/types";

// Deliberately separate from lib/api.ts: a different token, a different storage key, and a
// different base path (/api/admin), so an admin session and a regular user session on the
// same browser never collide or share state.
const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const ADMIN_TOKEN_KEY = "wageTracker.adminToken";

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}
export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}
export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/admin${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new AdminApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AdminApiError((body as { error?: string }).error || `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export interface AdminUserSummary {
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
}

export function adminLogin(password: string): Promise<{ token: string }> {
  return request("/login", { method: "POST", body: JSON.stringify({ password }) });
}

export function fetchAllUsers(): Promise<{ users: AdminUserSummary[] }> {
  return request("/users");
}

export function fetchUserDetail(id: string): Promise<{ user: User; shifts: Shift[] }> {
  return request(`/users/${id}`);
}

export function deleteUser(id: string): Promise<void> {
  return request(`/users/${id}`, { method: "DELETE" });
}
