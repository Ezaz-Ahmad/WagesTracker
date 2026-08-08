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

export interface PasswordValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Case-folds and applies Unicode NFC normalization so two passwords that
 * look identical but are encoded differently (e.g. an accented character as
 * one composed code point vs. a base letter + combining mark) compare
 * equal. Used only to decide whether the *whole* password matches a
 * blocklisted common password — never to decide what actually gets hashed,
 * and never to strip or reshape characters the way the app-specific check
 * below does.
 */
function normalizeExact(raw: string): string {
  return raw.normalize("NFC").toLowerCase();
}

/**
 * Same case-folding/NFC normalization as above, plus stripping everything
 * but letters and digits — used only for the app-specific check, where the
 * goal is "does this password contain the app's name in any decorated
 * form" (spacing, punctuation, casing all ignored), not "is this password
 * exactly a known-common one."
 */
function normalizeForSubstring(raw: string): string {
  return normalizeExact(raw).replace(/[^\p{L}\p{N}]/gu, "");
}

const COMMON_PASSWORD_SET = new Set(COMMON_PASSWORD_BLOCKLIST.map(normalizeExact));

/**
 * General common/breached-style passwords are checked as an EXACT match
 * against the whole (normalized) password, not a substring — substring
 * matching over-blocks: a perfectly good long passphrase like "my
 * grandmother's dark chocolate cake recipe" contains the common password
 * "chocolate" as a substring, but is nothing like it as an actual
 * credential. NIST-style blocklists are meant to catch a candidate that
 * *is* a known-common password, not one that merely mentions an ordinary
 * word somewhere inside a much longer, otherwise-fine passphrase.
 */
function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORD_SET.has(normalizeExact(password));
}

/**
 * App-specific terms are a different kind of check: the goal is catching
 * "this password is obviously tied to WagesTracker" in any decorated form
 * ("Wage-Tracker!23", "MyWageTracker2026"), so substring matching is
 * intentional and correct here, unlike for the general list above.
 */
function containsAppSpecificTerm(password: string): boolean {
  const normalized = normalizeForSubstring(password);
  return APP_SPECIFIC_BLOCKLIST.some((term) => normalized.includes(term));
}

/**
 * Validates a candidate password against the app's password policy.
 *
 * Deliberately does NOT trim or otherwise transform the input before
 * hashing — leading/trailing spaces are legal, meaningful characters in a
 * password (e.g. from a password manager or a multi-word passphrase), and
 * stripping them here would silently accept a password different from the
 * one the user will actually be authenticated with later. The
 * normalization functions above exist only to decide whether the password
 * *matches the blocklist*; they never touch the string that gets hashed.
 * Length is measured in Unicode code points (not UTF-16 code units) so
 * multi-byte/astral characters — emoji included — each count as one
 * character rather than two.
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

  if (containsAppSpecificTerm(password)) {
    return { valid: false, error: "Password can't contain the app name — choose something less guessable" };
  }
  if (isCommonPassword(password)) {
    return { valid: false, error: "That password is too common — please choose something more unique" };
  }

  return { valid: true };
}
