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

export interface PasswordValidationResult {
  valid: boolean;
  error?: string;
}

/** NFC-normalizes and case-folds for the general blocklist's exact-match
 * check — never used to decide what actually gets submitted/hashed. */
function normalizeExact(raw: string): string {
  return raw.normalize("NFC").toLowerCase();
}

/** Same, plus stripping non-alphanumerics, for the app-specific
 * substring check only (see backend for the full rationale). */
function normalizeForSubstring(raw: string): string {
  return normalizeExact(raw).replace(/[^\p{L}\p{N}]/gu, "");
}

const COMMON_PASSWORD_SET = new Set(COMMON_PASSWORD_BLOCKLIST.map(normalizeExact));

/** Exact match only — a passphrase that merely contains an ordinary word
 * (e.g. "chocolate") must not be blocked just because that word happens to
 * also be a common standalone password. See backend/src/security/passwordPolicy.ts. */
function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORD_SET.has(normalizeExact(password));
}

/** Substring match is intentional here — catches any decorated form of the
 * app's name inside an otherwise-fine password. */
function containsAppSpecificTerm(password: string): boolean {
  const normalized = normalizeForSubstring(password);
  return APP_SPECIFIC_BLOCKLIST.some((term) => normalized.includes(term));
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

  if (containsAppSpecificTerm(password)) {
    return { valid: false, error: "Can't contain the app name — choose something less guessable" };
  }
  if (isCommonPassword(password)) {
    return { valid: false, error: "That's a very common password — please choose something more unique" };
  }

  return { valid: true };
}
