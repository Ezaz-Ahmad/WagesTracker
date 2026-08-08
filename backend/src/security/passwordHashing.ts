import bcrypt from "bcryptjs";

/**
 * bcrypt cost factor (aka "rounds") used for hashing new passwords.
 * Configurable via BCRYPT_COST so it can be tuned for the hardware this
 * actually runs on without a code change; defaults to 12, which is above
 * bcryptjs's own default of 10 and in line with current OWASP guidance.
 * Falls back to the default for anything outside bcrypt's sane range
 * instead of letting a bad env var silently produce a useless hash.
 */
const BCRYPT_COST = (() => {
  const raw = Number(process.env.BCRYPT_COST);
  return Number.isInteger(raw) && raw >= 4 && raw <= 20 ? raw : 12;
})();

/**
 * Hashes a password asynchronously (bcrypt's `hash`, not the blocking
 * `hashSync`) — a sync bcrypt call at cost 12 blocks the single Node event
 * loop for real, noticeable time, which under load turns into stalled
 * request handling for every other in-flight request, not just the slow one.
 * Never logs the raw password or the resulting hash.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Async counterpart to hashPassword, for the same event-loop reason. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
