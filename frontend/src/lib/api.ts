import { getDeviceInstallationId } from "./deviceInstallation";
import type {
  DayExpense,
  PaymentMethod,
  PersonalExpense,
  Shift,
  SpendingCategory,
  SpendingColour,
  SpendingIcon,
  SpendingSummary,
  User,
  WeekExtra,
  WeekStart,
} from "./types";
import {
  getStoredToken,
  isStoredTokenRemembered,
  removeStoredToken,
  storeToken,
} from "../platform/tokenStorage";

// In local dev this is left unset and Vite's dev-server proxy forwards "/api" to the backend
// (see vite.config.ts). In production, set VITE_API_URL to the deployed backend's origin
// (e.g. https://wage-tracker-api.onrender.com) since the frontend and backend are hosted separately.
const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const CLIENT_TIME_ZONE_HEADER = "X-Client-Time-Zone";
const TIME_ZONE_FALLBACK_MESSAGE = "We couldn't determine your device time zone. Refresh the app and try again.";

export function getToken(): string | null {
  return getStoredToken();
}

/** `remember=true` (the default) persists across browser restarts; `false` keeps
 * the session only until the tab/browser closes — the "Remember me" checkbox. */
export function setToken(token: string, remember: boolean = true): Promise<void> {
  return storeToken(token, remember);
}
export function clearToken(): Promise<void> {
  return removeStoredToken();
}
/** Whether the current session is in "remember me" storage (localStorage,
 * survives a browser restart) rather than session-only storage. Used so a
 * replacement token issued mid-session (see changePassword below) gets
 * stored the same way the current one was, instead of quietly downgrading a
 * remembered session to a session-only one or vice versa. */
export function isRemembered(): boolean {
  return isStoredTokenRemembered();
}

const LAST_ACTIVITY_KEY = "wageTracker.lastActivity";

/** Timestamp (ms) of the last recorded user activity, in localStorage rather
 * than component state so it survives the app being minimized, backgrounded,
 * or fully closed and relaunched — the idle-logout check needs the *real*
 * elapsed time even when no in-page timer was alive to track it. Shared
 * across tabs for the same reason: any activity anywhere resets the clock,
 * and if every tab is closed the stored value simply stops moving, which is
 * exactly the "how long has this actually been idle" signal we want. */
export function recordActivity(): void {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}
export function getLastActivity(): number | null {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  return raw ? Number(raw) : null;
}
export function clearLastActivity(): void {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
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

/** Pings the backend's lightweight health endpoint directly — no auth header,
 * no JSON error parsing, just "did it answer." Used by the "waking up"
 * screen to know when a cold Render instance has actually spun back up.
 * Deliberately separate from `fetchMe` (the actual session check that
 * decides whether the user is logged in): this just answers "is the server
 * up yet," which resolves slightly sooner since it skips the DB lookup.
 *
 * A health response only ever carries two facts — "not answered yet" and
 * "answered successfully" — so callers should treat this as a boolean
 * readiness signal only, never as a basis for a percentage.
 *
 * `externalSignal` lets the caller cancel this specific request from
 * outside (component unmount, or the user pressing Retry) in addition to
 * this function's own `timeoutMs` abort — both are wired to the same
 * underlying AbortController, so whichever fires first wins. */
export async function pingHealth(timeoutMs: number = 10000, externalSignal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }
  try {
    const res = await fetch(`${API_ORIGIN}/api/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
    const errorBody = body as { error?: string; code?: string };
    const message = errorBody.code === "INVALID_CLIENT_TIME_ZONE"
      ? TIME_ZONE_FALLBACK_MESSAGE
      : errorBody.error || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, errorBody.code);
  }
  return body as T;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  address: string;
  workLocationName: string;
  workAddress: string;
  multipleLocations: boolean;
  otherLocations: string;
  rate: number;
}

/**
 * `deviceInstallationId` identifies this installation of the app so the
 * server can rotate its existing session instead of adding another one — the
 * reason one phone no longer accumulates an "Safari on iOS" entry per login.
 * Omitted entirely (rather than sent as null) when storage is unavailable,
 * since the server treats a missing id as "an older client" and logs in
 * normally. See lib/deviceInstallation.ts.
 */
export function signup(input: SignupInput): Promise<{ token: string; user: User }> {
  const deviceInstallationId = getDeviceInstallationId();
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ ...input, ...(deviceInstallationId ? { deviceInstallationId } : {}) }),
  });
}

/** Requests a reset without revealing whether the address has an account.
 * The backend intentionally returns the same success shape either way. */
export function requestPasswordReset(email: string): Promise<{ message: string }> {
  return request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Checks a token without consuming it. POST keeps the credential out of
 * access-log URLs while still allowing the page to avoid showing a form for
 * an already-expired link. */
export function checkPasswordResetToken(token: string): Promise<{ valid: true }> {
  return request("/auth/reset-password/validate", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function resetPassword(token: string, password: string): Promise<{ message: string }> {
  return request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

/** `notice` carries a server-side explanation the user needs to see — today
 * only "you were signed in on too many devices, so the least recently used
 * was signed out". Optional, and absent on an ordinary login. */
export function login(
  email: string,
  password: string
): Promise<{ token: string; user: User; notice?: string }> {
  const deviceInstallationId = getDeviceInstallationId();
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, ...(deviceInstallationId ? { deviceInstallationId } : {}) }),
  });
}

export function fetchMe(): Promise<{ user: User }> {
  return request("/me");
}

/**
 * Validates an arbitrary bearer token against the backend without touching
 * the stored session at all — deliberately bypasses `request()`/`getToken()`.
 * Used by the biometric-login flow (see AppContext): a token recovered from
 * the native Keychain must be confirmed still good against the backend
 * *before* it is trusted as the active session, so it can never become "the"
 * stored token, even briefly, if it turns out to be expired or revoked.
 */
export async function fetchMeWithToken(token: string): Promise<{ user: User }> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorBody = body as { error?: string };
    throw new ApiError(errorBody.error || `Request failed (${res.status})`, res.status);
  }
  return body as { user: User };
}

export interface MePatch {
  name?: string;
  address?: string;
  workLocationName?: string;
  workAddress?: string;
  multipleLocations?: boolean;
  otherLocations?: string;
  weekStartsOn?: WeekStart;
  rate?: number;
  goalHours?: number;
  goalEarnings?: number;
}

export function patchMe(patch: MePatch): Promise<{ user: User; extras?: WeekExtra[] }> {
  return request("/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteAccount(password: string): Promise<void> {
  return request("/me", { method: "DELETE", body: JSON.stringify({ password }) });
}

/**
 * Changes the current user's password. The backend responds `204 No
 * Content` (see backend/src/routes/me.ts) but hands back a replacement
 * session token — needed because the change invalidates every token issued
 * before it, including the one this very request is using — in the
 * `X-New-Token` response header rather than a JSON body, so it can't go
 * through the generic `request()` helper above (which only ever returns a
 * parsed body). Fetches directly instead, mirroring request()'s auth-header
 * and error-shape handling.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ token: string }> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/me/password`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error || `Request failed (${res.status})`, res.status);
  }

  const newToken = res.headers.get("X-New-Token");
  if (!newToken) {
    // Shouldn't happen against this app's own backend — surfaced as an error
    // rather than silently leaving the old (about-to-be-invalidated) token
    // in place, which would just fail on the very next request instead.
    throw new ApiError("Password was changed, but no replacement session token was returned.", 500);
  }
  return { token: newToken };
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
  biometricProtected: boolean;
}

/** Lists the current user's own active (non-revoked, non-expired) sessions —
 * powers the "Security & Sessions" list in Settings. Never includes a raw
 * JWT, password hash, or anything about another user's sessions; that's
 * enforced server-side, not just by what this function happens to render. */
export function listSessions(): Promise<{ sessions: SessionInfo[] }> {
  return request("/me/sessions");
}

/** Revokes one session by id. `revokedCurrent` tells the caller whether that
 * was the session backing the request making this very call — if so, the
 * caller is responsible for logging itself out locally right away, rather
 * than waiting for some future request to fail. */
export function revokeSession(sessionId: string): Promise<{ revokedCurrent: boolean }> {
  return request(`/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

/** Revokes every session except the one making this call — "log out all
 * other devices." Never touches the current session. */
export function revokeOtherSessions(): Promise<void> {
  return request("/me/sessions/others", { method: "DELETE" });
}

/**
 * Marks (`true`) or unmarks (`false`) the session backing the current
 * token as biometric-protected — exempts it from the server's idle timeout
 * (see backend/src/security/sessions.ts's validateSession) on the theory
 * that Face ID/Touch ID re-entry on this device is itself the "was this
 * really the account owner" check an idle timeout otherwise approximates,
 * and moves it onto the matching absolute lifetime (5 years while
 * protected, the ordinary 30 days once it isn't — see
 * BIOMETRIC_SESSION_TTL_MS on the backend).
 *
 * The backend responds `204 No Content` but hands back a replacement
 * session token in the `X-New-Token` header rather than a JSON body — same
 * reason and same shape as `changePassword` above: the call revokes the
 * caller's current session as part of rotating it onto the new lifetime, so
 * the token this very request authenticated with is about to stop working,
 * and the caller must switch to the returned one (via `setToken`) right
 * away rather than let the next request discover that the hard way.
 * Fetches directly rather than going through `request()`, for the same
 * reason `changePassword` does.
 *
 * Called from AppContext right before/after enabling biometric login and
 * right after disabling it; see those call sites for how a failure here is
 * handled (never allowed to block Face ID itself, but the returned token —
 * when there is one — must always be applied, since a failure to apply an
 * already-issued token would silently leave the live session pointed at one
 * this call just revoked).
 */
export async function setSessionBiometricProtection(enabled: boolean): Promise<{ token: string }> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/me/sessions/current`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ biometricProtected: enabled }),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error || `Request failed (${res.status})`, res.status);
  }

  const newToken = res.headers.get("X-New-Token");
  if (!newToken) {
    throw new ApiError("Session was updated, but no replacement session token was returned.", 500);
  }
  return { token: newToken };
}

/** Server-side logout: revokes the session backing the current token, so a
 * copied/stolen token stops working immediately rather than just being
 * forgotten client-side. Deliberately doesn't swallow its own errors — the
 * caller (AppContext's logout) decides how to handle a failure, and must
 * always still clear the local token regardless of whether this succeeds. */
export function logout(): Promise<void> {
  return request("/auth/logout", { method: "POST" });
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

function shiftWriteHeaders(): Record<string, string> {
  return { [CLIENT_TIME_ZONE_HEADER]: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function createShift(input: ShiftInput): Promise<{ shift: Shift }> {
  return request("/shifts", { method: "POST", headers: shiftWriteHeaders(), body: JSON.stringify(input) });
}

export function patchShift(id: string, patch: Partial<ShiftInput>): Promise<{ shift: Shift }> {
  return request(`/shifts/${id}`, { method: "PATCH", headers: shiftWriteHeaders(), body: JSON.stringify(patch) });
}

export function deleteShift(id: string): Promise<void> {
  return request(`/shifts/${id}`, { method: "DELETE" });
}

export function listDayExpenses(from: string, to: string): Promise<{ expenses: DayExpense[] }> {
  return request(`/day-expenses?from=${from}&to=${to}`);
}

/** Upserts (or clears, with `null`) the fuel cost for a single calendar day. */
export function setDayExpense(date: string, fuelCost: number | null): Promise<{ expense: DayExpense | null }> {
  return request(`/day-expenses/${date}`, { method: "PUT", body: JSON.stringify({ fuelCost }) });
}

export function listWeekExtras(from: string, to: string): Promise<{ extras: WeekExtra[] }> {
  return request(`/week-extras?from=${from}&to=${to}`);
}

/** Upserts (or clears, with `amount: null`) the single "other earnings" entry
 * for a week, identified by that week's start date. A reason is required
 * whenever an amount is set. */
export function setWeekExtra(
  weekStart: string,
  patch: { amount: number | null; reason: string }
): Promise<{ extra: WeekExtra | null }> {
  return request(`/week-extras/${weekStart}`, { method: "PUT", body: JSON.stringify(patch) });
}

function spendingWriteHeaders(): Record<string, string> {
  return { [CLIENT_TIME_ZONE_HEADER]: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function listSpendingCategories(includeArchived = false): Promise<{ categories: SpendingCategory[] }> {
  return request(`/spending/categories${includeArchived ? "?includeArchived=true" : ""}`);
}

export function createSpendingCategory(input: {
  name: string;
  icon: SpendingIcon;
  colour: SpendingColour;
}): Promise<{ category: SpendingCategory }> {
  return request("/spending/categories", { method: "POST", body: JSON.stringify(input) });
}

export function patchSpendingCategory(
  id: string,
  patch: Partial<{ name: string; icon: SpendingIcon; colour: SpendingColour; archived: boolean }>
): Promise<{ category: SpendingCategory }> {
  return request(`/spending/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function archiveSpendingCategory(id: string): Promise<void> {
  return request(`/spending/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface PersonalExpenseInput {
  amountCents: number;
  categoryId: string;
  spentAt: string;
  merchant?: string;
  note?: string;
  paymentMethod?: PaymentMethod | null;
  clientRequestId?: string;
}

export function listPersonalExpenses(params: {
  from?: string;
  to?: string;
  categoryId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ expenses: PersonalExpense[]; page: number; pageSize: number; total: number; hasMore: boolean }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/spending/expenses${suffix}`);
}

export function createPersonalExpense(input: PersonalExpenseInput): Promise<{ expense: PersonalExpense }> {
  return request("/spending/expenses", {
    method: "POST",
    headers: spendingWriteHeaders(),
    body: JSON.stringify(input),
  });
}

export function patchPersonalExpense(
  id: string,
  patch: Partial<Omit<PersonalExpenseInput, "clientRequestId">>
): Promise<{ expense: PersonalExpense }> {
  return request(`/spending/expenses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: spendingWriteHeaders(),
    body: JSON.stringify(patch),
  });
}

export function deletePersonalExpense(id: string): Promise<void> {
  return request(`/spending/expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getSpendingSummary(from: string, to: string): Promise<SpendingSummary> {
  return request(`/spending/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}
