import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

/**
 * All *new* password hashes (signup, password change, and the transparent
 * upgrade below) use Argon2id — the OWASP-recommended default for new
 * applications. Implemented via `hash-wasm`, a pure WebAssembly build with
 * no native/compiled bindings, deliberately for the same reason this
 * project uses `bcryptjs` instead of native `bcrypt`: this repo's
 * `node_modules` is a folder shared between this sandbox and the user's
 * real (Windows) machine, and a platform-specific compiled binary built on
 * one OS is useless — or actively broken — on the other. Pure WASM/JS has
 * no such problem.
 *
 * Existing accounts created before this migration still have a bcrypt hash
 * (`$2a$`/`$2b$`/`$2y$`) stored in `users.password_hash`. Those are never
 * deleted or forced to reset — `verifyPassword` below still knows how to
 * check a password against either format, and a successful login using a
 * legacy bcrypt hash transparently rehashes the password with Argon2id and
 * overwrites the stored hash (see routes/auth.ts's login handler), so the
 * whole user base migrates itself over time through normal use rather than
 * needing a bulk migration or forced password reset.
 */

/** OWASP-minimum-or-better Argon2id parameters, all configurable via env
 * vars for hardware-specific tuning, with secure defaults if unset:
 * memory cost 19 MiB (in KiB, as hash-wasm expects), 2 iterations,
 * parallelism 1. */
const ARGON2_MEMORY_COST_KIB = (() => {
  const raw = Number(process.env.ARGON2_MEMORY_COST_KIB);
  return Number.isInteger(raw) && raw >= 19 * 1024 ? raw : 19 * 1024;
})();
const ARGON2_TIME_COST = (() => {
  const raw = Number(process.env.ARGON2_TIME_COST);
  return Number.isInteger(raw) && raw >= 2 ? raw : 2;
})();
const ARGON2_PARALLELISM = (() => {
  const raw = Number(process.env.ARGON2_PARALLELISM);
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
})();
const ARGON2_HASH_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;

export type HashFormat = "argon2id" | "bcrypt";

/** Identifies which algorithm produced a stored hash from its own prefix —
 * every format this app has ever used self-describes this way, so no
 * separate "algorithm" column is needed. Returns null for anything
 * unrecognized (treated as "never verifies" by verifyPassword, rather than
 * throwing). */
export function detectHashFormat(hash: string): HashFormat | null {
  if (hash.startsWith("$argon2id$")) return "argon2id";
  if (/^\$2[aby]\$/.test(hash)) return "bcrypt";
  return null;
}

/** True for a hash that should be transparently upgraded the next time its
 * password is successfully verified (currently: any legacy bcrypt hash). */
export function needsRehash(hash: string): boolean {
  return detectHashFormat(hash) === "bcrypt";
}

/**
 * Hashes a password with Argon2id. Always used for *new* hashes — signup,
 * password change, and the login-time upgrade of a legacy bcrypt hash.
 * Never pre-truncates or otherwise transforms the password: the full
 * Unicode string goes in as-is, and Argon2 (unlike bcrypt's silent 72-byte
 * cutoff) hashes the entire input.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(ARGON2_SALT_LENGTH);
  return argon2id({
    password,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_TIME_COST,
    memorySize: ARGON2_MEMORY_COST_KIB,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "encoded",
  });
}

/**
 * Verifies a password against a stored hash of either supported format —
 * dispatches on the hash's own prefix (see detectHashFormat) rather than
 * needing the caller to know or track which algorithm produced it. Returns
 * false (never throws) for an unrecognized hash format, so a corrupted or
 * unexpected value fails closed instead of crashing the request.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const format = detectHashFormat(hash);
  if (format === "argon2id") return argon2Verify({ password, hash });
  if (format === "bcrypt") return bcrypt.compare(password, hash);
  return false;
}
