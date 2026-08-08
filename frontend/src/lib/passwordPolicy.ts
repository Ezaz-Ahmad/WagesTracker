import { APP_SPECIFIC_BLOCKLIST, COMMON_PASSWORD_BLOCKLIST } from "./commonPasswords";

/**
 * Frontend mirror of backend/src/security/passwordPolicy.ts, for immediate
 * inline feedback only (e.g. as the user types a new password) — the
 * backend re-validates every password against its own copy of this policy
 * and is the only thing that actually enforces it. Never rely on this
 * module alone to decide whether a password is acceptable.
 */
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

const MIN_SUBSTRING_MATCH_LENGTH = 6;

export interface PasswordValidationResult {
  valid: boolean;
  error?: string;
}

function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/gi, "");
}

function containsBlockedTerm(normalized: string, list: readonly string[]): boolean {
  for (const term of list) {
    if (normalized === term) return true;
    if (term.length >= MIN_SUBSTRING_MATCH_LENGTH && normalized.includes(term)) return true;
  }
  return false;
}

/** Same rules as the backend — see security/passwordPolicy.ts there for the
 * full rationale. Not trimmed, length measured in Unicode code points. */
export function validatePassword(password: string): PasswordValidationResult {
  if (!password) {
    return { valid: false, error: "Password is required" };
  }

  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Must be at least ${MIN_PASSWORD_LENGTH} characters (${length} so far)` };
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `Must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }

  const normalized = normalize(password);

  if (containsBlockedTerm(normalized, APP_SPECIFIC_BLOCKLIST)) {
    return { valid: false, error: "Can't contain the app name — choose something less guessable" };
  }
  if (containsBlockedTerm(normalized, COMMON_PASSWORD_BLOCKLIST)) {
    return { valid: false, error: "That's a very common password — please choose something more unique" };
  }

  return { valid: true };
}
