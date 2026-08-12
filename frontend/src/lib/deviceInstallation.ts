/**
 * A stable identifier for *this installation of the app* — one value per
 * browser profile, or per "Add to Home Screen" install on iOS — generated
 * once and kept in localStorage.
 *
 * It exists so the server can tell "the same phone signing in again" from "a
 * new device", which is what stops the Settings sessions list growing an
 * identical "Safari on iOS" entry on every single login. Signing in with a
 * known installation id rotates that installation's existing session instead
 * of adding another one (see backend/src/security/sessions.ts).
 *
 * What it deliberately is not:
 *
 *  - Not a credential. Knowing someone else's installation id grants
 *    nothing: every server-side lookup using it is scoped to the
 *    already-authenticated user, so it can only ever affect your own
 *    sessions. It is sent in the request body, not treated as a secret, and
 *    the server never returns it to the client.
 *  - Not a device fingerprint. It's a random UUID this app generated about
 *    itself; nothing is derived from hardware, fonts, canvas, or any other
 *    passive signal, and it can't be correlated across sites.
 *  - Not a substitute for the token. The auth token continues to live where
 *    it always has; this identifies the installation, never authenticates it.
 *
 * Clearing site data regenerates it, and that's fine — the old sessions age
 * out under the idle/absolute expiry rules, and the user can revoke them by
 * hand in the meantime. The alternative (deriving identity from IP address
 * or user-agent) is worse in the way that matters: two phones on one home
 * Wi-Fi would merge into a single entry, and one phone would split into
 * several as it moved between Wi-Fi and mobile data.
 */

const STORAGE_KEY = "wageTracker.deviceInstallationId";

/** Matches the server's validator (backend/src/security/sessionPolicy.ts).
 * Anything stored that doesn't look like a UUID is replaced rather than
 * sent, so a corrupted or hand-edited value can't turn into a 400 on every
 * login attempt with no way out. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateUuid(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // Fallback for older WebKit: still cryptographically random, just assembled
  // by hand. Math.random() is deliberately not used even here — a predictable
  // installation id would let one device impersonate another's identity in
  // the sessions list, which is confusing at best.
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "";
}

/**
 * The installation id for this browser/PWA install, creating and storing one
 * on first use.
 *
 * Returns null rather than throwing when storage is unavailable (private
 * mode with storage blocked, a locked-down embedded webview, storage quota
 * exceeded). A login without an installation id still works — it simply
 * isn't deduplicated — and that is a far better outcome than an app that
 * refuses to sign in because it couldn't write a convenience value.
 */
export function getDeviceInstallationId(): string | null {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && UUID_PATTERN.test(existing)) return existing;

    const created = generateUuid();
    if (!created) return null;
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** Forgets this installation's identity. Used when the account is deleted —
 * the sessions it was tied to no longer exist, so keeping the id would only
 * link a fresh account to a stale one. */
export function clearDeviceInstallationId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: an id we can't remove is still harmless.
  }
}
