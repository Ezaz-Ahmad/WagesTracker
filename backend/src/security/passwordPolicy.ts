import { APP_SPECIFIC_BLOCKLIST, COMMON_PASSWORD_BLOCKLIST } from "./commonPasswords.js";

/**
 * Single source of truth for what makes a password acceptable — imported by
 * every backend code path that sets a password (signup, change-password) so
 * the rule can never drift between them. The backend is authoritative here:
 * any client-side copy of these rules (see frontend/src/lib/passwordPolicy.ts)
 * exists only to give the user faster feedback and must never be trusted on
 * its own.
 *
 * Follows current NIST SP 800-63B guidance: a long minimum length instead of
 * forced character-composition rules, a generous maximum so passphrases and
 * password-manager output both fit, and a check against known-common/
 * compromised-style passwords rather than "must contain a symbol."
 */
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

/** Blocklist entries at or above this length are also checked as a
 * substring of the (normalized) candidate password, so a padded variant
 * like "password12345678" or "Wage-Tracker-2026!" is still caught even
 * though it isn't a literal match for anything in the list. Kept fairly
 * high to avoid flagging a short common syllable inside an otherwise fine
 * long passphrase. */
const MIN_SUBSTRING_MATCH_LENGTH = 6;

export interface PasswordValidationResult {
  valid: boolean;
  error?: string;
}

/** Lowercases and strips everything but letters/digits, so spacing,
 * punctuation, and casing can't be used to dodge the blocklist (e.g.
 * "Wage-Tracker!" and "wagetracker" are the same thing for this check).
 * Deliberately NOT used for length validation — length is checked against
 * the real, untouched password the user will actually authenticate with. */
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

/**
 * Validates a candidate password against the app's password policy.
 *
 * Deliberately does NOT trim the input — leading/trailing spaces are legal,
 * meaningful characters in a password (e.g. from a password manager or a
 * multi-word passphrase) and stripping them here would silently accept a
 * password different from the one the user will actually be authenticated
 * with later. Length is measured in Unicode code points (not UTF-16 code
 * units) so multi-byte/astral characters — emoji included — each count as
 * one character rather than two.
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (typeof password !== "string" || password.length === 0) {
    return { valid: false, error: "Password is required" };
  }

  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }

  const normalized = normalize(password);

  if (containsBlockedTerm(normalized, APP_SPECIFIC_BLOCKLIST)) {
    return { valid: false, error: "Password can't contain the app name — choose something less guessable" };
  }
  if (containsBlockedTerm(normalized, COMMON_PASSWORD_BLOCKLIST)) {
    return { valid: false, error: "That password is too common — please choose something more unique" };
  }

  return { valid: true };
}
