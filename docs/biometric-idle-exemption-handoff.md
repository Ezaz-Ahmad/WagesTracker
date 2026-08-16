# Biometric session idle-timeout exemption — architecture and verification

Lives on `feature/ios-shift-notification` (stacked the same way as that
feature — see `docs/shift-notification-handoff.md`'s "Branch strategy"
section, which applies identically here). This is a distinct fix from the
shift-notification feature; it's on the same branch only because it was
found and fixed in the same working session, directly from a screenshot the
repository owner sent of the symptom below.

## The reported symptom

A screenshot of the login screen showing two stacked, dismissible error
banners at once:

> Your saved sign-in has expired. Please log in again.
>
> Your session expired. Please log in again.

— alongside the question "why is Face ID saying session expired? It's
supposed to work like a password, so it should never expire unless I
change devices, like a banking app."

## Root cause

Not two bugs — two symptoms of one design gap. The backend enforces a
10-minute idle timeout on every session (`SESSION_IDLE_TIMEOUT_MS` in
`backend/src/security/sessionPolicy.ts`), and biometric login never got an
exemption from it: Face ID only ever unlocks the *same* underlying session
token recovered from Keychain, so once that token's session has idle-expired
server-side, Face ID has nothing valid left to recover either.

The exact sequence that produces both banners at once: the app sits
backgrounded (not force-quit — the process stays alive, so React state
persists) for more than 10 minutes while logged in. On foreground resume,
`AppContext`'s `subscribeAppResume` effect calls `refresh()`, which calls
`fetchMe()`. That 401s (the session is genuinely idle-expired server-side),
triggering `logout()` — a soft lock, since biometric login is on — and
`setAuthError("Your session expired. Please log in again.")`. Back at the
login screen, the user (reasonably, given the promise of biometric login)
taps the Face ID retry icon. `attemptBiometricAuthentication` recovers the
*same* dead token from Keychain, `fetchMeWithToken` 401s again, and — because
`sessionInvalid` is true — clears the biometric credential entirely and sets
`biometricLoginError = "Your saved sign-in has expired. Please log in
again."` The net effect is worse than doing nothing: not only does Face ID
fail to help, using it after the idle window actively destroys the stored
credential, forcing the user back into Settings to re-enable it after
logging in with a password again.

Real banking apps don't do this because Face ID/PIN *is* their re-entry
protection — the underlying session lives much longer, and biometrics
substitutes for aggressive idle expiry rather than sitting behind it. That
was confirmed as the desired direction with the repository owner (an
explicit choice among three options: exempt biometric-protected sessions
only, raise the idle timeout for everyone, or leave the security posture
unchanged and just fix the duplicate error message) before writing any code,
since it's a real security trade-off, not a pure bug fix.

## Design: exempt biometric-protected sessions, narrowly

**Backend.** `user_sessions` gets a new `biometric_protected INTEGER NOT
NULL DEFAULT 0` column (migration in `backend/src/db.ts`, following the
existing `device_installation_id`/`device_name` ALTER TABLE pattern).
`validateSession` (`backend/src/security/sessions.ts`) skips its idle check
—`row.last_seen_at <= idleBefore`— when that flag is set, but every other
check (absolute `expires_at`, `revoked_at`, `token_version`) still applies
unconditionally. A new `setSessionBiometricProtection(sessionId, userId,
protectedFlag)` function flips the flag, scoped to `sessionId + userId` the
same defense-in-depth way every other single-session mutation in that file
is. A new endpoint, `PATCH /api/me/sessions/current` (`backend/src/routes
/me.ts`), lets the caller's own current session set the flag on itself —
deliberately no way to target any other session, since biometric protection
is inherently a property of "the credential this specific device is
holding."

**Frontend.** `AppContext.tsx`'s `enableBiometricLoginAction` calls
`api.setSessionBiometricProtection(true)` right after the Keychain
credential is created and the ordinary token is demoted — best-effort,
*not* part of that transaction: Face ID is already fully working at that
point, so a failure here must not roll back the credential or report
`enable()` as failed, only mean this session keeps the ordinary idle
timeout until the call (or the next enable) succeeds.
`clearBiometricCredential` (shared by every disable/logout/cleanup path)
calls `setSessionBiometricProtection(false)` the same way, best-effort —
frequently with no session left that can actually authenticate the call
(e.g. `attemptBiometricAuthentication`'s own catch branch calls this right
after the recovered token itself just 401'd), which is fine: a session that
can't authenticate at all doesn't need its flag cleared to start behaving
ordinarily again.

The idle-auto-logout `useEffect` in `AppContext.tsx` — the one that arms a
local `setTimeout` and a `visibilitychange`/`focus`/`pageshow` backstop,
entirely independent of any server round trip — now bails out immediately
when `biometricStatus.enabled` is true, added to its dependency array so it
re-arms/disarms live as biometric login is toggled from Settings. Without
this half of the fix, the server-side exemption alone wouldn't have been
enough: the client would still force a local logout purely from its own
clock, regardless of what the server would have said.

**Settings UI.** The sessions list (`SessionCard.tsx`) now shows a "Face
ID/Touch ID" badge on any session currently exempt this way, so the "why
didn't this expire" question is answered before anyone has to ask it.

## What this deliberately does not change

- The absolute session lifetime — a biometric-protected session still
  eventually requires a fresh login, just not from mere inactivity. At the
  time this fix shipped that lifetime was the ordinary `SESSION_TTL_MS` (30
  days) for every session, biometric-protected or not; a direct follow-up
  request extended it specifically for biometric-protected sessions to 5
  years — see `docs/biometric-5-year-session-handoff.md` for that design.
  Nothing else about the exemption described here changed as part of that.
- Revocation and password-change invalidation (`token_version`) — both
  still kill a biometric-protected session immediately, same as any other.
- Non-biometric sessions — completely unaffected; the idle timeout,
  client-side and server-side, is byte-for-byte the same as before for
  anyone who hasn't turned Face ID/Touch ID on.
- `attemptBiometricAuthentication`'s existing "a genuine 401 clears the
  credential" behavior — still correct and still desired. With the
  exemption in place, a biometric-protected session basically never
  legitimately 401s from idle time alone anymore, so this path is now only
  reached for a truly dead credential (revoked, deleted account, password
  changed elsewhere, or the 30-day absolute expiry) — exactly the cases
  where clearing it is the right call.

## Testing

Backend: `backend/test/session-idle.test.ts` gained a
`describe("biometric-protected sessions are exempt from idle expiry")`
block — a protected session survives 10x the idle timeout; flipping the
flag back off brings the ordinary rejection right back on the same session;
the exemption never overrides absolute expiry or revocation; an idle
protected session still appears in the sessions list. A new file,
`backend/test/session-biometric-protection.test.ts`, covers the `PATCH
/api/me/sessions/current` endpoint itself: marking/unmarking, scoping (never
affects another session or another user's), input validation, that it
never touches `last_seen_at`/`expires_at`, and that it's reflected in the
sessions list response.

Frontend: `frontend/src/context/__tests__/biometricIdleExemption.test.tsx`
covers the client-side idle timer directly — still fires normally when
biometric login is off (baseline/regression guard), does not fire once
biometric login is enabled (even 20 simulated idle minutes later), resumes
firing immediately once biometric login is turned back off, calls
`setSessionBiometricProtection(true/false)` on enable/disable, and — best
effort — still reports `enable()` as successful even if that call fails.
`frontend/src/settings/__tests__/SessionList.test.tsx` gained a case for the
new badge appearing only on the protected session.

Every new/changed test in this fix was run against the pre-fix code (via
`git stash` toggling the relevant files) and confirmed to fail there before
being confirmed to pass against the fix — including catching a mistake in
the test itself along the way: an early version of the "turned back off"
backend test forgot that the intervening successful request had already
refreshed `last_seen_at` past the throttle, so the session no longer looked
idle regardless of the flag — fixed by re-aging the session after flipping
the flag off, not by weakening the assertion.

## Full verification, this revision

| Check | Result |
|---|---|
| Backend tests | **212/212 passed**, 21 files (was 200 before this session; +12 for this fix) |
| Frontend tests | **572/572 passed**, 64 files |
| Backend typecheck | clean |
| Frontend typecheck | clean |
| Backend build | clean |
| Frontend build | clean |
| `npm audit` | **0 vulnerabilities** |

This fix touches no Swift/iOS-native code at all — it's entirely backend
(schema + endpoint + validation) and frontend TypeScript/React — so unlike
the shift-notification feature on this same branch, there is no
Xcode/macOS-toolchain verification gap here. It can be fully exercised by
this repo's existing Node-based test suite and CI.
