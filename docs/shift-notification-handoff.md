# Shift-in-progress notification (iOS) — architecture, security, and verification

Lives on `feature/ios-shift-notification`, based on
`fix/ios-biometric-logout-soft-lock` (`f22cbf1`) at the time this branch was
created — that branch is itself not yet merged into `main`. This branch is
therefore **stacked**: its diff against `main` includes everything from
`feature/ios-biometric-login` and `fix/ios-biometric-logout-soft-lock` as
well as this feature's own commits, until those merge first. See "Branch
strategy" at the end of this document.

This document covers one feature, not a bug fix: a persistent "shift in
progress" local notification with a working in-notification "Sign out"
action, requested directly by the repository owner, with an explicit
request for "required testing and error handling... so that the app
doesn't crash or anything."

## What this is, and what it deliberately is not

iOS has no equivalent of Android's undismissable foreground-service
notification — there is no API that prevents a user from swiping any
notification away, local or remote. Before writing any code, this
constraint was confirmed explicitly with the repository owner (see the
PR/commit history for that exchange), and the agreed behavior is:

- The notification appears the moment a shift starts.
- It survives the app being backgrounded, the device being locked, and the
  app being closed outright (swiped away from the app switcher).
- It goes away only when the user swipes it away manually, **or** the
  shift actually ends (in-app, or via the notification's own "Sign out"
  button) — never on a timer, never because the OS decided to reclaim it
  for space.
- Swiping it away manually does **not** end the shift. The shift keeps
  running exactly as if the notification had never been posted; there is
  simply nothing visible reminding the user about it anymore. This is a
  hard platform limitation, not a bug in this implementation.

The second agreed decision, also confirmed explicitly before writing code:
what happens when the notification's own "Sign out" button is tapped but
the background network request can't complete (no connectivity, or the OS
reclaims the execution window before the request finishes). The chosen
behavior is **retry automatically next time the app opens** — the shift
stays running (never guessed-at or force-closed on stale data), the
intended sign-out is recorded locally, and the app finishes the job
automatically, silently, the next time it's opened — no user action
required, no data loss.

## Architecture

**Shared platform-neutral contract** (`frontend/src/platform/shiftNotifications.ts`),
mirroring `biometricAuth.ts`/`tokenStorage.ts`/`pdfDelivery.ts`'s existing
pattern in this codebase exactly: a `ShiftNotificationAdapter` interface, a
web no-op default (`WebShiftNotificationAdapter` — every method a no-op,
`getPendingEndShift()` always resolves `null`), and a module-level
`configureShiftNotifications()` swap point. A future Android
implementation is a second class behind the same interface with zero
changes needed anywhere else in the app.

**Native adapter** (`frontend/src/platform/nativeShiftNotifications.ts`)
wraps a `registerPlugin<ShiftNotificationPluginPort>("ShiftNotification")`
call, translating the raw Capacitor plugin port into the typed contract.
Every method is wrapped in try/catch and never throws or rejects — a
notification permission problem, or any other native failure, must never
be allowed to look like starting or ending a shift itself failed (see
`useTodayShift.ts` below).

**App-local Swift plugin** (`ios/App/App/ShiftNotificationPlugin.swift`),
same mechanism as `BiometricAuthPlugin.swift`: `CAPPlugin` + `CAPBridgedPlugin`
conformance, compiled directly into the App target (four coordinated
`project.pbxproj` entries — `PBXBuildFile`, `PBXFileReference`, group
membership, `PBXSourcesBuildPhase` membership — same pattern already
established for `BiometricAuthPlugin.swift`/`MainViewController.swift`),
registered from `MainViewController.capacitorDidLoad()` via
`bridge?.registerPluginInstance(ShiftNotificationPlugin())`.

**Why the notification delegate is wired up in `AppDelegate`, not
`MainViewController`.** A tap on the notification's "Sign out" action can
relaunch/resume the app process specifically to deliver that response, even
if the app wasn't running — but that execution window is short and
unreliable for spinning up a full Capacitor WebView/JS bridge from cold.
`MainViewController.capacitorDidLoad()` may never run at all in that
particular process lifetime. So the actual PATCH request is made directly
in native Swift (`URLSession`, not the JS bridge), and
`UNUserNotificationCenter.current().delegate` plus the notification
category are both set up in
`AppDelegate.application(_:didFinishLaunchingWithOptions:)` — before the
bridge, window, or view controller exist at all — so the delegate is ready
to catch a background-launch response regardless of whether (or how far)
`MainViewController`'s own setup gets in that particular launch.

**Backend contract replicated natively.** `performEndShiftRequest` builds a
`PATCH {apiBaseUrl}/api/shifts/:id` request matching
`frontend/src/lib/api.ts`'s own convention exactly: `Content-Type:
application/json`, `Authorization: Bearer <token>`, and the required
`X-Client-Time-Zone` header (`TimeZone.current.identifier`) the backend's
`shiftRules.ts` validates against — omitting or mis-formatting this header
is rejected with `400 INVALID_CLIENT_TIME_ZONE` server-side, so it's not
optional. The body is `{"signOut": "HH:MM:SS"}`, wall-clock local time
captured via a `DateFormatter` matching `frontend/src/lib/date.ts`'s
`nowHHMMSS()` semantics (`en_US_POSIX` locale, current time zone, captured
at the moment "Sign out" is tapped — not re-derived later, so a delayed
background retry still records when the user actually asked to sign out).

**`start()`/`end()` wiring** (`frontend/src/lib/useTodayShift.ts`):
`start()` posts the notification, fire-and-forget, immediately after
`createShift` succeeds — but only if there's a session token to hand the
native layer, and never at all if `createShift` itself failed (nothing to
notify about). `end()` clears the notification only after `updateShift`'s
PATCH actually succeeds — never optimistically, and never if the PATCH
failed.

**Pending-reconciliation effect** (`frontend/src/context/AppContext.tsx`):
runs once per signed-in session (gated by a ref, the same pattern as the
biometric cold-launch effect), checks for a pending record left by a
background "Sign out" the native side couldn't finish, and — if one
exists — finishes the PATCH through `updateShiftOrThrow` (the same
rethrowing helper every other mutating shift action uses, so a 401 during
reconciliation triggers the exact same expired-session logout + message as
any other authenticated request). Any other failure (the shift was already
ended some other way, already deleted, whatever) is swallowed silently —
there's no user action this reconciliation is a direct response to, so
surfacing an "action failed" banner the instant the app opens would be
confusing rather than helpful. The pending record is cleared after exactly
one attempt either way, so a persistently-failing reconciliation can never
turn into a retry loop on every launch.

## Security model

**Credential storage**: a dedicated Keychain item, separate from the
biometric feature's own items —
`com.ezazahmad.wagestracker.shiftNotification` / `credential` — holding
exactly what the background PATCH needs: shift id, API base URL, and the
current session's bearer token. Same trust boundary as the token already
stored behind biometrics (not a new kind of secret), but deliberately
**not** gated behind biometrics itself
(`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, not
`.biometryCurrentSet`) — a background notification-action wake has no user
present to authenticate a Face ID/Touch ID prompt, so gating it that way
would make the feature simply never work in the one scenario it exists
for (the app not being open).

**Lifecycle**: the credential is written when the notification is posted
(shift start) and deleted the instant its job is done — either because the
shift ended through the app itself (`clearShiftNotification()` deletes it
alongside removing the notification), or because a "Sign out" tap was
processed in the background (successfully or not — either way there is
nothing left for that credential to do). Never left behind stale.

**Pending-record storage**: `UserDefaults`, not Keychain — deliberately,
since it holds no secret (just a shift id and a wall-clock time string).

**No new secrets, no new npm dependency.** Apple's own
`UserNotifications`/`Security`/`Foundation` frameworks only, same posture
as the biometric plugin.

## A real bug found and fixed during implementation

While building the native-adapter translation layer
(`nativeShiftNotifications.ts`), the original design had
`getPendingEndShift()` resolve an empty Swift dictionary (`[:]`) when
nothing was pending, with the JS side typed to expect `null` in that case.
Capacitor plugin calls can only ever resolve to an object, never a bare JS
`null` — so an empty object (`{}`) would have come back **truthy** on the
JS side. `AppContext`'s `if (!pending) return;` guard would have failed to
detect "nothing pending" and gone on to call
`updateShiftOrThrow(undefined, { signOut: undefined })` on every single
login for any user who had never used this feature at all — a real bug
that would have surfaced universally, not an edge case.

Caught before it shipped, redesigned with an explicit `hasPending: boolean`
flag instead (`{ hasPending: false }` vs. `{ hasPending: true, shiftId,
signOut }`), and a regression test
(`nativeShiftNotifications.test.ts`, `"treats hasPending: true with a
missing shiftId/signOut as nothing pending rather than a corrupt record"`)
proven to fail against the naive `if (!result.hasPending) return null;`
check and pass against the actual `if (!result.hasPending ||
!result.shiftId || !result.signOut) return null;` fix.

A second, smaller correctness gap was found and fixed in this same pass,
in the *verification script* rather than the feature itself: the extended
`verify-ios-plugin-registration.mjs`'s "is this file actually listed in the
Sources build phase" check originally searched the whole `project.pbxproj`
file for the string `"X.swift in Sources */"` — but that exact string also
appears in the *comment* on the file's own `PBXBuildFile` entry, so the
check would have kept passing even with the actual `PBXSourcesBuildPhase`
membership line deleted. Fixed by scoping that search to the
`PBXSourcesBuildPhase` section specifically, and proven with the same
fail-before/pass-after discipline (deleting the membership line reproduces
the gap; the tightened regex catches it, the original loose regex did
not).

## Full verification, this revision

| Check | Result |
|---|---|
| Backend tests | **200/200 passed**, 20 files (unaffected by this feature — run to confirm no collateral damage) |
| Frontend tests | **565/565 passed**, 63 files |
| — of which, shift-notification-specific | `platform/__tests__/shiftNotifications.test.ts` (5/5), `platform/__tests__/nativeShiftNotifications.test.ts` (10/10), `lib/__tests__/useTodayShift.notifications.test.tsx` (6/6), `context/__tests__/shiftNotificationReconciliation.test.tsx` (5/5) — 26 new tests total, every one proven to fail against the pre-fix/reverted code and pass against the fix |
| Frontend typecheck | clean |
| Frontend build | clean |
| `npm audit` | **0 vulnerabilities** |
| `verify:ios-plugin-registration` (extended) | passed — both `BiometricAuthPlugin.swift` and `ShiftNotificationPlugin.swift` compiled/registered/storyboard-wired; AppDelegate notification delegate + category wiring confirmed |
| `ios:sync` (Capacitor sync) | passed — web bundle copied to `ios/App/App/public`, `nativeShiftNotifications` chunk present in the build output, `Package.swift` regenerated, 5 plugins resolved |

**Cannot be verified in this sandbox**: this is a Linux container with no
Xcode/macOS toolchain, so `ShiftNotificationPlugin.swift` has not been
compiled by an actual Swift compiler here — only structurally verified via
the extended plugin-registration script above. Actual on-device behavior —
the notification posting and looking right, the "Sign out" action
appearing and working while the app is fully closed, the background
`URLSession` request actually completing within iOS's execution-window
constraints, the offline/pending-reconciliation path actually reconciling
on next launch — none of this can be confirmed without GitHub's macOS
Simulator workflow (`ios-simulator.yml`) plus real physical-device testing.
This feature is genuinely more complex and more fragile than the biometric
plugin was — background execution and notification-delegate timing have
more moving parts and less forgiving failure modes than a foreground
Face ID prompt — so physical-device verification here matters more, not
less, before shipping to TestFlight.

## Branch strategy

This branch (`feature/ios-shift-notification`) is stacked on
`fix/ios-biometric-logout-soft-lock`, which is itself stacked on the
now-merged `feature/ios-biometric-login` history. None of that stacking is
this feature's own concern — `AppContext.tsx` in particular already
carries the biometric soft-lock changes from the branch this one is based
on. Recommended order: merge `fix/ios-biometric-logout-soft-lock` into
`main` first (it already has its own PR/CI in progress), then either rebase
this branch onto the resulting `main` before opening its own PR, or open it
now as a PR targeting `fix/ios-biometric-logout-soft-lock` and let GitHub
retarget it automatically once that branch merges. Either way, this
sandbox has no push/PR/merge access to the repository — see the delivery
notes accompanying this branch's git bundle for the exact commands.
