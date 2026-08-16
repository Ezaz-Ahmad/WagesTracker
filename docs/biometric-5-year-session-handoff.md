# Biometric-protected 5-year session lifetime — architecture and verification

Lives on `feature/ios-shift-notification`, stacked the same way as the rest
of this branch — see `docs/shift-notification-handoff.md`'s "Branch
strategy" section, which applies identically here. This is a direct
follow-up to `docs/biometric-idle-exemption-handoff.md`: same feature area,
found and requested in the same working session right after that fix
shipped, once the repository owner asked a natural follow-up question about
it.

## The request

After the idle-timeout exemption above landed, the repository owner asked
whether a biometric-protected session could still expire at all — the
answer at the time was yes: even with Face ID/Touch ID on, the session's own
**30-day absolute lifetime** (`SESSION_TTL_MS`) still applied unconditionally,
same as every other session, so a still-in-daily-use device would
eventually be forced back to a full password re-login regardless of how
often Face ID confirmed the account owner in between. The follow-up
request: extend that to 5 years.

Before writing any code, this was flagged back as a real trade-off, not a
pure bug fix — the naive version (raising `SESSION_TTL_MS`/`TOKEN_TTL`
themselves) would apply to *every* login, password-only and web included,
meaning a stolen or leaked token from any of those stays usable for 5 years
instead of 30 days. Given the choice between that and scoping the extension
to biometric-protected sessions only, the repository owner chose the
narrower, biometric-only option.

## Why this can't be "just extend the column"

The existing idle-timeout exemption (see the sibling handoff doc) is a
single `biometric_protected` column read by `validateSession` — flipping it
is enough, because idle expiry is a purely server-side check against
`last_seen_at`.

The absolute lifetime is different in one important way: a JWT's `exp`
claim is computed once, at `jwt.sign` time, and baked into the token string
itself. `requireAuth` checks that claim (`jwt.verify`) *before* it ever
queries the database — so extending `user_sessions.expires_at` in the
database does nothing for a token that was already signed with the ordinary
30-day `TOKEN_TTL`; that token still stops working in 30 days regardless of
what the row says. Genuinely extending a session's lifetime requires minting
a **new** JWT with a longer `expiresIn`, which means the client's currently
stored credential — including whatever the native Keychain item holds for
biometric login — has to be replaced with it, not just have a database flag
flipped underneath it.

## Design

**Backend.** `BIOMETRIC_SESSION_TTL_MS` (5 years) joins `SESSION_TTL_MS` (30
days) in `backend/src/security/sessionPolicy.ts`. `signToken`
(`backend/src/auth.ts`) gained an optional `ttlOverrideMs` parameter — when
given, it replaces the ordinary `TOKEN_TTL` for that one call; every
existing caller is unaffected since the parameter defaults to `undefined`.

`setSessionBiometricProtection` (the old flag-flip function in
`backend/src/security/sessions.ts`) is replaced by
`rotateSessionForBiometricProtection`, which performs a full rotation — the
same pattern `changePassword` in `routes/me.ts` already uses for its own
replacement session: revoke the caller's current session row and insert a
replacement in the same write batch (never both-active, never both-gone),
carrying over `user_agent`/`ip_address`/`device_installation_id`/
`device_name` so the sessions list doesn't show a duplicate device entry,
with `expires_at` set to `BIOMETRIC_SESSION_TTL_MS` when turning protection
on or back to `SESSION_TTL_MS` when turning it off. `PATCH
/api/me/sessions/current` (`backend/src/routes/me.ts`) now signs a fresh
token for the replacement session and returns it via the `X-New-Token`
response header — the same header/204-body split `PATCH /api/me/password`
already uses, for the same reason: the token that authenticated the request
is revoked as part of handling it, so the response has to hand back
something that still works.

**Frontend — why the upgrade happens *before* the Face ID/Touch ID prompt,
not after.** The previous (idle-timeout-only) design called
`setSessionBiometricProtection(true)` as a fire-and-forget step *after* the
native `enable()` prompt had already succeeded and stored a token — that
was fine when the call only flipped a column, since the token already
stored didn't need to change. It doesn't work once the call can return a
*different* token: `BiometricAuthPlugin.swift`'s `enable()` method always
prompts biometrics before writing to Keychain, and there is no separate
"overwrite the stored credential without re-prompting" method (writing
itself doesn't require the biometric context — only *reading* the
credential item back does — but the JS/native bridge doesn't expose a
write-only path today). Prompting Face ID/Touch ID a second time immediately
after the first, just to swap in the upgraded token, would be poor UX for
something that should be invisible.

So `enableBiometricLoginAction` (`frontend/src/context/AppContext.tsx`) now
attempts the rotation **first**, before calling the native adapter at all:

1. Call `api.setSessionBiometricProtection(true)`. On success, apply the
   returned token as the live session token (`api.setToken(rotated,
   api.isRemembered())`, preserving whatever persistence mode was already in
   effect — this is not yet the "biometrics replaces Remember Me" demotion,
   just keeping the app functional if it's backgrounded before the prompt
   resolves, since the token this replaced was revoked the instant the
   rotation succeeded). On failure, fall back to whatever token was already
   on hand — the upgrade is best-effort and must never block Face ID itself;
   a session that fails to upgrade here just keeps the ordinary 30-day
   lifetime until the next successful call, exactly like the idle-exemption
   flag's own best-effort behavior.
2. Call the native adapter's `enable()` with whichever token resulted from
   step 1 — one prompt, storing the (hopefully already 5-year) token
   directly.
3. On success, demote to session-only as before (`api.setToken(token,
   false)`), with the existing keychain-storage-failure rollback extended to
   also undo the rotation (via `clearBiometricCredential`, see below).
4. **New:** if the prompt itself fails or is cancelled *after* step 1 already
   rotated the session, roll that back — call `clearBiometricCredential`,
   which rotates the session a second time, back onto the ordinary
   lifetime. Without this, a cancelled "enable" would silently leave an
   ordinary, no-Face-ID-actually-on session sitting idle-exempt and
   5-years-lived, which is a real (if narrow) security regression the
   rollback exists specifically to close.

`clearBiometricCredential` (shared by disable, logout, password change,
account deletion, and a failed post-biometric backend validation) now
applies the token `setSessionBiometricProtection(false)` returns, the same
way — `api.setToken(reverted, api.isRemembered())` — since the rotation it
now performs revokes whatever token was live at the time of the call, and a
caller that didn't pick up the replacement would find its own live session
dead on the next request. This is still best-effort and still frequently
has nothing to authenticate the call at all (e.g. a Face ID credential that
just 401'd for real) — that's fine, same as before: a session that can't
authenticate doesn't need rotating back to start behaving ordinarily again.

**Settings UI.** The "Face ID/Touch ID" badge and its tooltip in
`SessionCard.tsx` now mention the 5-year lifetime alongside the idle-timeout
exemption, and `BiometricLoginSettings.tsx`'s copy (both the on and off
states) explains the longer session length so it isn't a silent behavior
change from the user's point of view.

## What this deliberately does not change

- **Password-only and web sessions** — completely unaffected. `TOKEN_TTL`
  and `SESSION_TTL_MS` (30 days) are untouched; only a session that is
  actually biometric-protected ever sees `BIOMETRIC_SESSION_TTL_MS`.
- **Revocation and password-change invalidation** — still kill a
  biometric-protected session immediately, exactly as before. The 5-year
  figure is a ceiling, not a guarantee.
- **The idle-timeout exemption itself** — unchanged; this is additive to it,
  not a replacement.
- **`changePassword`'s own session replacement** — still always creates an
  ordinary `SESSION_TTL_MS` session, on purpose (see its own comment): a
  password change is exactly the point where re-enabling biometrics should
  be a conscious choice again, not something that silently carries over a
  5-year credential.

## Testing

Backend: `backend/test/session-biometric-protection.test.ts` was rewritten
around the new contract (every test now expects and chains through the
`X-New-Token` response header, since the token that made the PATCH call is
revoked by it). New coverage: the old token is provably dead immediately
after rotation (proving this is a real rotation, not a flag flip); the new
session's `expires_at` lands within a tight tolerance of `now +
BIOMETRIC_SESSION_TTL_MS` when turning protection on, and back to `now +
SESSION_TTL_MS` when turning it off; an invalid request body never rotates
anything (the caller's original token still works afterward); and
`device_installation_id` carries over so the sessions list doesn't grow a
duplicate entry. `session-idle.test.ts`'s existing biometric-exemption
coverage needed no changes — it drives `biometric_protected` directly via
SQL, independent of how production code sets it, so it continues to cover
`validateSession`'s exemption logic unchanged.

Frontend: a new `frontend/src/context/__tests__/biometricSessionUpgrade.test.tsx`
covers the token-upgrade choreography specifically — the native adapter is
called with the rotated (long-lived) token rather than the original one; a
failed upgrade still lets Face ID enable with whatever token was on hand,
without a spurious rollback call; and a cancelled Face ID prompt after a
successful rotation triggers the rollback (a second, reverse rotation, the
native credential never actually stored, `biometricStatus.enabled` staying
false). `biometricIdleExemption.test.tsx`'s existing mocks were updated to
match the new `{ token }` return shape but required no behavioral changes —
none of its assertions depended on the old fire-and-forget void return.

Every new/changed backend test was run against the pre-fix code (`git
stash` toggling `auth.ts`/`sessionPolicy.ts`/`sessions.ts`/`routes/me.ts`)
and confirmed to fail there first: 6 of the 9 tests in the rewritten file
failed against the old flag-flip endpoint, in exactly the ways the new
contract predicts (no `X-New-Token` header, the old token still valid
instead of revoked, `expires_at` unchanged). The three new frontend tests
were run the same way against pre-fix `AppContext.tsx`/`api.ts`: 2 of 3
failed (the adapter was called with the original token instead of the
rotated one, and the rollback call never happened), while the third —
"still enables biometrics with the ordinary token if the upgrade call
fails" — correctly still passed, since that best-effort fallback behavior
was already correct before this change and this fix was never meant to
touch it.

## Full verification, this revision

| Check | Result |
|---|---|
| Backend tests | **214/214 passed**, 21 files (was 212 before this change; +2 net — the rewritten biometric-protection file grew from 7 to 9 tests) |
| Frontend tests | **575/575 passed**, 65 files (+3 for the new biometricSessionUpgrade.test.tsx) |
| Backend typecheck | clean |
| Frontend typecheck | clean |
| Backend build | clean |
| Frontend build | clean |
| `npm audit` | **0 vulnerabilities** |

Like the idle-timeout exemption, this touches no Swift/iOS-native code —
entirely backend (constants + rotation + endpoint) and frontend
TypeScript/React — so it's fully exercised by this repo's existing
Node-based test suite and CI, with no Xcode/macOS-toolchain verification
gap. The one native-adjacent fact this design leans on —
`BiometricAuthPlugin.swift`'s `enable()` always prompts before writing, and
there is no prompt-free "update stored credential" method — is read
directly from that file's existing comments, not verified by a new Swift
change.
