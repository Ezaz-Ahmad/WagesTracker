# Biometric login (Face ID / Touch ID) — architecture, security, and verification

`PR #17` (`feature/ios-biometric-login`) merged into `main` at `52d8eab` on
2026-08-15, after the plugin-registration fix, the Remember-Me fix, and the
enablement-transaction hardening fix below were all verified. `main` was
previously at `9185368` — the confirmed `v1.16.0` TestFlight
release-candidate commit — and this merge did not change the app version,
did not touch the TestFlight workflow, and does not affect the `v1.16.0`
release candidate in any way (see the confirmation further down).

This document covers four fixes in total: two blocking issues found in
review of the first revision of PR #17, one further hardening fix found in
review of the second revision (all three merged into `main` as part of PR
#17), and a fourth behavioral fix — described in its own branch,
`fix/ios-biometric-logout-soft-lock` — made after physical-device TestFlight
testing surfaced a real UX gap post-merge. Each has regression coverage:

1. **The native plugin was never registered with the Capacitor bridge.**
   `BiometricAuthPlugin.swift` conforming to `CAPBridgedPlugin` makes the
   class discoverable, but that alone does not register an instance of it —
   Capacitor's own docs
   ([custom-code](https://capacitorjs.com/docs/ios/custom-code),
   [viewcontroller](https://capacitorjs.com/docs/ios/viewcontroller)) are
   explicit that an app-local plugin (compiled directly into the App
   target, not pulled in as its own package) needs a custom bridge view
   controller subclass calling `bridge?.registerPluginInstance(...)` from
   `capacitorDidLoad()`, and the storyboard's Bridge View Controller has to
   actually point at that subclass. The file wasn't even in the Xcode
   target's Sources build phase — only `AppDelegate.swift` compiled. Fixed
   below.
2. **A Remember-Me session bypassed Face ID entirely.** The cold-launch
   restore logic checked for an ordinary persisted token first and, if
   found, signed straight back in without ever attempting biometrics —
   meaning turning Face ID on did nothing observable for anyone who already
   had Remember Me enabled, which is the majority case. Fixed below.
3. **The biometric-enablement transaction could throw despite its
   documented contract.** Fix 2's own demotion call
   (`api.setToken(token, false)`) sits between "the native biometric
   credential now exists" and "the enable call reports success" — if that
   storage write failed, the exception propagated straight out of a
   function documented as never throwing, leaving the just-created
   credential in place while biometric status could end up reported
   inconsistently. Fixed below.
4. **Logging out silently defeated biometric login on the very next
   attempt.** Discovered on a physical device after PR #17 merged and
   shipped to TestFlight: turning Face ID on and then testing it via
   "swipe up to close, reopen" worked correctly, but testing it via the
   in-app "Log out" button did not — the Face ID icon disappeared from the
   login screen entirely and re-enabling required going back into Settings.
   This was intentional-but-undesired behavior, not a bug in the strict
   sense (see Fix 4 below for why), but it did not match the product
   requirement once stated explicitly: biometric login should keep working
   across an explicit logout, the same as it does across a cold app
   restart, until the user turns it off from Settings. Fixed below.

## Fix 1 — registering the plugin with the bridge

Three changes, matching Capacitor's documented pattern exactly:

- **`ios/App/App/MainViewController.swift`** (new) — subclasses
  `CAPBridgeViewController`, overrides `capacitorDidLoad()`, and calls
  `bridge?.registerPluginInstance(BiometricAuthPlugin())`. This is the only
  supported way to register a plugin that lives in the app target itself
  rather than being pulled in as its own Cocoapod/SPM package with a
  manifest Capacitor's automatic plugin discovery can see.
- **`ios/App/App/Base.lproj/Main.storyboard`** — the Bridge View
  Controller's `customClass` changed from `CAPBridgeViewController`
  (`customModule="Capacitor"`, the framework default) to `MainViewController`
  (`customModule="App"`, the app's own target). Without this, the subclass
  above is dead code — the storyboard would still instantiate the plain
  framework class, whose `capacitorDidLoad()` never calls into it.
- **`ios/App/App.xcodeproj/project.pbxproj`** — both
  `BiometricAuthPlugin.swift` and `MainViewController.swift` added as
  `PBXFileReference`/`PBXBuildFile` entries and listed in the target's
  `PBXSourcesBuildPhase`, the same entries Xcode itself would generate by
  adding these files through the UI. Confirmed by diffing against
  `AppDelegate.swift`'s existing entries and matching the exact same
  four-place pattern (file reference, build file, group membership, sources
  phase membership).

### Regression guard: `frontend/scripts/verify-ios-plugin-registration.mjs`

This exact class of bug — a native file that compiles fine in isolation but
was never wired into the app — passed every check the first version of this
PR ran, because none of those checks needed Xcode or ran against a real
Simulator build in this sandbox (which has no macOS toolchain). The new
script closes that gap without needing one either: it's plain text/JSON
parsing of `project.pbxproj`, `Main.storyboard`, and the Swift source files
themselves, checking:

1. `BiometricAuthPlugin.swift` has both a `PBXFileReference` and a
   `PBXBuildFile` entry, and that build file is listed in the target's
   Sources build phase (i.e., it's actually compiled, not just present on
   disk).
2. At least one other compiled Swift file subclasses
   `CAPBridgeViewController` and calls
   `registerPluginInstance(BiometricAuthPlugin())` from within it, and that
   file is itself compiled into the target the same way.
3. `Main.storyboard`'s Bridge View Controller `customClass` matches that
   exact class name, with `customModule="App"`.

Wired into `npm run verify:ios-plugin-registration` (root `package.json`),
and into two workflows:

- **`.github/workflows/ci.yml`** (`frontend` job) — runs on every push/PR to
  `main`, on a plain `ubuntu-latest` runner, no macOS needed. This is the
  fast, cheap check that now runs on this PR itself.
- **`.github/workflows/ios-simulator.yml`** — runs before the expensive
  Simulator build, so a registration regression fails in seconds instead of
  after a multi-minute Xcode build.

**Verified working in both directions**, not just written and assumed
correct: run against the original (pre-fix) commit, it fails with
`"BiometricAuthPlugin.swift has no PBXFileReference in project.pbxproj — it
is not part of the Xcode project."` — the exact defect the review found. Run
against the fixed tree, it passes.

This script cannot verify the Swift actually *compiles* — that still needs
a real Xcode toolchain, unavailable in this sandbox, and will run
automatically on `ios-simulator.yml`'s macOS runner once this branch's CI
runs on GitHub. What it does verify — the wiring between the plugin, the
bridge controller, and the storyboard — is exactly the part that isn't
Swift-compiler-checked at all (a `CAPBridgeViewController` subclass that
never gets referenced anywhere still compiles cleanly) and so is exactly
the part a passing Simulator build wouldn't have caught either, unless
someone actually exercised `BiometricAuth` calls at runtime on-device.

## Fix 2 — Remember Me no longer bypasses Face ID

**Before:** `AppContext`'s cold-launch restore effect checked
`api.getToken()` first. If Remember Me had left an ordinary persisted
token behind, the app signed back in through that token unconditionally —
the biometric auto-prompt logic only ever ran in the `else` branch, when no
ordinary token existed. Enabling Face ID while Remember Me was already on
(the common case) was therefore a no-op from the user's perspective: the
next launch skipped straight past biometrics.

**After**, in `enableBiometricLoginAction` (`frontend/src/context/AppContext.tsx`):
once the native `enable()` call succeeds, the same token is re-stored via
`api.setToken(token, false)` — i.e. demoted from "remembered" to
session-only:

- **The ordinary persistent session is removed.** `setToken(..., false)`
  deletes the Keychain entry that would otherwise have survived a cold
  launch (see `platform/nativeSecureTokenStorage.ts`'s `setToken`, which
  calls `secureStore.removeItem` for `remember: false`).
- **The current in-memory session is untouched.** The same call updates the
  adapter's in-memory `session` field to `{ token, remembered: false }`
  rather than clearing it — `getToken()` still returns the token for the
  rest of this running process, so nothing about the session the user is
  currently in changes. No forced logout, no re-authentication needed to
  keep using the app right now.
- **The next cold launch requires biometrics.** With nothing persisted,
  `api.getToken()` returns `null` on the next launch, which is exactly the
  branch `restoreSession` already uses to attempt biometric auto-login —
  the same code path exercised by every other cold-launch biometric test in
  this PR. Biometrics becomes the only path back into the app without
  re-entering a password.
- **A no-op when Remember Me was already off.** `setToken(token, false)`
  when the session is already session-only just re-writes the same state.
- **Web is unaffected.** The web adapter's `enable()` always resolves
  `{ outcome: "failed", reason: "unavailable" }` (see
  `platform/biometricAuth.ts`'s `WebBiometricAuthAdapter`) — this branch is
  structurally unreachable there, and `BiometricLoginSettings` itself never
  renders outside `Capacitor.isNativePlatform()` in the first place, so
  there's no UI path to reach it either.

Turning biometrics back **off** does not re-grant the ordinary persisted
session automatically — the account goes back to a session-only token until
the next explicit login (with Remember Me checked, if desired). This is a
deliberate choice, not an oversight: re-granting persistence silently on
disable would mean a security-relevant, persistence-relevant decision
happening without the user directly making it at that moment. This is
called out explicitly here in case it's not the intended behavior.

### Regression test

`frontend/src/context/__tests__/biometricLogin.test.tsx`, new describe
block `"Remember Me and biometric login"`, test `"Remember Me enabled ->
enable Face ID -> restart -> Face ID is required"`. Uses a small harness
component (`RememberMeHarness`) calling `useApp()` directly rather than
going through the Settings screen's toggle button, which only renders
behind `Capacitor.isNativePlatform()` — false under jsdom, same constraint
every other test in this file already works around. What's under test is
`AppContext`'s own contract, which is where both the bug and the fix live.

The test: logs in with Remember Me checked, asserts the session was
persisted (`remembered: true`); enables biometrics, asserts the same
session was demoted (`remembered: false`) as a direct consequence of that
call, not a hand-set value; unmounts and remounts an entirely fresh
provider to simulate a cold launch; asserts `authenticateWithBiometrics`
was called automatically and the app does not silently restore into a
signed-in state.

**Verified working in both directions** the same way as the plugin
registration check: reverting the `api.setToken(token, false)` line in
isolation makes this exact test fail with `expected { remembered: true }
to equal { remembered: false }` — restoring the line makes it pass again.

## Fix 3 — hardening the biometric-enablement transaction

**Before:** in `enableBiometricLoginAction`
(`frontend/src/context/AppContext.tsx`), once
`adapterEnableBiometricLogin` reported `outcome: "enabled"` (meaning the
native Keychain credential already exists), the follow-up
`await api.setToken(token, false)` demotion call from Fix 2 was not
guarded. If that Keychain write failed — device locked mid-write, storage
full, a concurrent access conflict — the rejection propagated straight out
of `enableBiometricLoginAction`, even though the function is documented
(and relied upon by its only call site, `BiometricLoginSettings.tsx`,
which does not attach a `.catch()`) as never throwing. That would have
surfaced as an unhandled promise rejection in production, left the
just-created biometric credential in Keychain with nothing to show for it
in the UI, and risked biometric status reading as either "on" (stale) or
"off" (accurate, but silently dropping the credential) depending on
whatever happened to run next.

**After:** the demotion call is wrapped in its own `try`/`catch` as part of
the same transaction:

- **The storage failure is caught**, not allowed to propagate.
- **The credential is rolled back** — `clearBiometricCredential()` is
  called, deleting the Keychain credential `adapterEnableBiometricLogin`
  just wrote (its own `disable()` call is already best-effort/non-throwing
  by contract; the rollback's own `.catch()` is a second line of defense
  in case a future adapter doesn't honor that, so a rollback failure can
  never itself produce an unhandled rejection on top of the original one).
- **Biometric status does not incorrectly remain enabled** —
  `clearBiometricCredential()` sets it to `{ enabled: false }` directly, so
  the UI never reports "on" for a transaction that ultimately failed.
- **A typed failure result and readable message are returned**:
  `{ outcome: "failed", reason: "keychain_error", error: "Couldn't finish
  turning on biometric sign-in. Please try again." }` — matching the same
  `BiometricEnableResult` shape every other failure path already returns,
  so `BiometricLoginSettings.tsx` needs no new handling to display it.
- **No unhandled promise rejection occurs** — the function's documented
  "never throws" contract now actually holds for this path too.
- **The user's current authenticated session remains safe and
  consistent** — nothing in this path touches `status`/`user`/the ordinary
  in-memory token; only the biometric credential and its status flag are
  affected. `NativeSecureTokenStorageAdapter.setToken` (see
  `platform/nativeSecureTokenStorage.ts`) also only updates its in-memory
  `session` field *after* the awaited Keychain call succeeds, so a failed
  demotion leaves the storage layer's own state exactly as it was before
  the failed call too — belt-and-suspenders with the app-level session
  fields staying untouched.

### Regression test

`frontend/src/context/__tests__/biometricLogin.test.tsx`, new test in the
`"Remember Me and biometric login"` describe block: `"rolls back the
credential and reports a typed failure when demoting the session storage
fails"`. Logs in with Remember Me checked, then forces the *second*
`api.setToken` call (the demotion call, not login's own persist) to
reject. The harness component's click handler deliberately has no
`.catch()` on the `enableBiometricLogin()` promise chain, mirroring the
real `BiometricLoginSettings.tsx` call site, so an unguarded regression
would surface as an unhandled rejection failing the test — not just a
wrong return value.

**Verified working in both directions**: run against the pre-fix code
(`AppContext.tsx`'s `try`/`catch` temporarily removed via `git stash`),
the test fails and Vitest additionally reports the exact unhandled
rejection (`Error: Keychain busy`) the fix exists to prevent. Run against
the fixed tree, it — and the other 11 tests in the file — pass.

## Fix 4 — Log out is a soft lock when biometric login is on

**Before:** `logout()` (`frontend/src/context/AppContext.tsx`) always did two
things unconditionally: fired a best-effort server-side revocation of the
current session (`api.logout()`, which the API layer itself documents as
"so a copied/stolen token stops working immediately"), and called
`clearBiometricCredential()`, deleting the stored Face ID/Touch ID
credential. That was a deliberate original design choice — the reasoning
was "a logged-out account has no session for a biometric credential to
unlock into" — but it meant the one button most people actually use to end
a session (as opposed to swipe-closing the app) silently turned biometric
login back off every time, with no indication why, and re-enabling required
a trip back into Settings.

**After:** `logout()` now branches on `biometricStatus.enabled`:

- **Biometric login off** — unchanged: server-side revoke, clear the local
  token, and clear any biometric credential defensively (covers a credential
  that exists in storage but hasn't been reflected into React state yet;
  cheap and always safe, since `disable()` is a no-op when nothing is
  stored).
- **Biometric login on** — the server-side revoke and the credential clear
  are both skipped. Only the local ordinary token is cleared, which is
  enough to drop back to the login screen. The stored biometric credential,
  and the backend session it points at, are both left alone — so the
  Face ID/Touch ID icon is still on the login screen immediately (no app
  restart needed, since `biometricStatus` in React state was never cleared)
  and tapping it (or the automatic prompt on the next actual cold launch)
  signs back into the exact same still-valid session.

This is a real, considered trade-off, not a silent weakening: skipping the
server-side revoke means that from the moment biometric login is turned on
until the user either disables it or uses "Log out all other devices" /
per-session revoke in `Settings → Security → Sessions`, the "Log out"
button no longer ends the account's session on the backend — it becomes a
device-local lock screen instead. The alternative (keep revoking on logout)
was tried conceptually and rejected: it would make the Face ID icon appear
correctly but fail every single time with "your saved sign-in has expired,"
since the token behind it would already be dead — worse than the original
behavior, not better. This trade-off was discussed and explicitly chosen
over keeping the original fully-revoking behavior.

### Regression test

`frontend/src/context/__tests__/biometricLogin.test.tsx`, new describe
block `"Log out is a soft lock when biometric login is enabled"`, two
tests:

1. `"does not revoke the session or clear the credential, and Face ID signs
   back in"` — logs in, enables biometrics, logs out, and asserts: `status`
   becomes `"loggedOut"`, the mocked server-side `api.logout` was **not**
   called, `disableBiometricLogin` was **not** called, and
   `biometricStatus.enabled` is still `true`. It then goes one step further
   than asserting flags: it actually triggers `retryBiometricLogin()` and
   confirms the app signs back in (`status` returns to `"loggedIn"`),
   proving the still-stored credential and still-valid session genuinely
   work together, not just that nothing got cleared.
2. `"still fully signs out (server revoke + credential clear) when
   biometric login was never enabled"` — same flow without ever enabling
   biometrics, asserting the original behavior (`api.logout` called,
   `disableBiometricLogin` called) is unchanged for the common case where
   biometrics was never turned on.

**Verified working in both directions**: with the `logout()` branch
temporarily reverted (`git stash` of `AppContext.tsx`), test 1 fails with
`expected "vi.fn()" to not be called at all, but actually been called 1
times` against the old unconditional `api.logout()` call — test 2 (the
already-existing-behavior case) still passes unmodified, confirming the fix
doesn't change anything for accounts that never turn biometrics on. With the
fix restored, all 14 tests in the file — including both new ones — pass.

## Full verification, this revision

| Check | Result |
|---|---|
| Backend tests | **200/200 passed**, 20 files |
| Frontend tests | **536/536 passed**, 59 files (previously 534; +2 for the Fix 4 soft-logout regression tests) |
| — of which, biometric-specific | **14/14 passed** in `biometricLogin.test.tsx` alone (12 from the previous revision + the two new soft-logout tests), plus the rest of the biometric-adapter/Settings/AuthScreen suites unchanged (`BiometricLoginSettings.test.tsx`: 9/9) |
| Backend typecheck | clean |
| Frontend typecheck | clean |
| Backend build | clean |
| Frontend build | clean |
| `npm audit` | **0 vulnerabilities** |
| `verify:libsql` | passed |
| `verify:capacitor` (JS/Swift version alignment) | passed — 8.4.2 on both sides |
| `verify:ios-plugin-registration` | passed — plugin compiled, registered, storyboard wired |
| `verify:capacitor:bundle` (one Capacitor runtime in the shipped bundle) | passed, against a real `ios:build:web && cap copy ios` output |
| `ios:build:web` + `ios:sync` (Capacitor sync) | passed — web bundle copied to `ios/App/App/public`, `Package.swift` regenerated, 5 plugins resolved |
| Marketing/app version | unchanged — `MARKETING_VERSION` / `frontend/package.json` / `CFBundleShortVersionString` all still `1.16.0` |
| `ios:testflight:verify` | passed — manual-trigger-only, off `main`, signing safeguards intact, unmodified by this branch |
| iOS Simulator build (GitHub Actions, macOS runner) | not runnable in this sandbox — verified after push, see the PR's check-runs |
| CodeQL | not runnable in this sandbox — verified after push, see the PR's check-runs |

**Still true, and still cannot be done in this sandbox**: this is a Linux
container with no Xcode/macOS toolchain, so the Swift has not been compiled
by an actual Swift compiler here — only structurally verified as described
above. Actual Face ID/Touch ID hardware prompts, and confirming the
`.biometryCurrentSet` re-enrollment invalidation path fires for real, both
require a physical device and cannot be verified in CI at all. Both of
these become checkable once this branch's own CI runs on GitHub's macOS
runners (`ios-simulator.yml`, `codeql.yml`) and once someone builds this
branch to a physical iPhone via Xcode.

## Everything else (architecture, Keychain security model, plugin choice)

Unchanged from the first revision of this PR — summarized here for a
single source of truth, since the previous handoff document was delivered
outside the repository and is not part of this PR's history (see "process
note" below).

**Biometrics supplements the backend session, never replaces it.** A
successful Face ID/Touch ID check only unlocks a token already issued by
the backend and stored (Keychain-only) on-device; that token is always
re-validated against the backend (`fetchMeWithToken`) before the app treats
the user as signed in. The password is never stored as part of this
feature.

**Storage: iOS Keychain only.** Two items under
`com.ezazahmad.wagestracker.biometric`: a non-secret `meta` record
(account id/label/kind, readable without a prompt so the UI can render
correctly) and a `credential` record (the token), gated behind
`SecAccessControlCreateWithFlags(..., .biometryCurrentSet, ...)` combined
with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. iOS itself
invalidates `.biometryCurrentSet` items when the device's enrolled
biometrics change; the plugin detects the resulting read failure and
deletes both items, reporting `credential_invalidated` back to JS. Nothing
here ever touches `localStorage`, Capacitor `Preferences`, or an
unencrypted file.

**One prompt per `authenticate()` call**, via reusing one `LAContext`
across `evaluatePolicy` and the subsequent `kSecUseAuthenticationContext`-
backed Keychain read. Policy is biometric-only
(`deviceOwnerAuthenticationWithBiometrics`) — no silent passcode fallback.

**Session-ending actions all clear the credential**: `logout()`,
`deleteAccount()`, and `changePassword()` each call the same
`clearBiometricCredential()` helper (best-effort — a Keychain failure is
logged, never thrown).

**Plugin choice**: `@aparajita/capacitor-secure-storage`'s Swift
implementation has no `LocalAuthentication`/`SecAccessControlCreateWithFlags`
support (confirmed by reading its source) — a plain Keychain key/value
store with no biometric-gating concept. Rather than fake biometric gating
in JS around it (which would mean the app, not the Keychain, decides when
the credential releases), this adds a small app-local Swift plugin using
only Apple's own `LocalAuthentication`/`Security` frameworks — no new npm
dependency, no supply-chain surface, and now (with Fix 1 above) correctly
wired into the actual app target.

**Architecture**: shared TypeScript interface
(`platform/biometricAuth.ts`'s `BiometricAuthAdapter`) with a web no-op
default, mirroring the existing `tokenStorage`/`pdfDelivery`/`connectivity`
adapters in this codebase. `platform/nativeBiometricAuth.ts` implements
that interface against the Swift plugin and is dependency-injectable for
testing. No auth logic lives in Swift — capability detection, one prompt,
and opaque Keychain read/write is all the plugin does; deciding what a
result means, backend re-validation, and credential-clearing all live in
`AppContext.tsx`. A future Android implementation is a second class behind
the same interface, with zero changes needed anywhere else in the app.

## `v1.16.0` release candidate — still unaffected

- No version number changed by any commit described in this document:
  `frontend/package.json`, `MARKETING_VERSION` in `project.pbxproj`, and
  `CFBundleVersion` in `Info.plist` are all still `1.16.0` after the merge.
- No TestFlight workflow file changed; `ios:testflight:verify` passed
  against the unmodified workflow, and the TestFlight run built from the
  actual merge commit (`52d8eab`) completed successfully.
- No signing certificate, `.p8`/`.p12`, provisioning profile, or
  environment-secret material was read, written, or referenced anywhere in
  any of this work.

## Process note: replacing the previous handoff document

The first revision of PR #17's description linked to
`HANDOFF-ios-biometric-login.md`, delivered directly to the repository
owner's machine rather than committed to the branch — a real gap the review
correctly flagged: nobody looking at the PR on GitHub could see it. This
document replaced it, lives at `docs/biometric-login-handoff.md`, and was
part of PR #17's actual history before it merged.

## Status

Fixes 1–3 merged into `main` as PR #17 on 2026-08-15 (`52d8eab`). A
TestFlight build from that exact commit was uploaded and verified
successfully on a physical Face ID iPhone — Face ID login works end to end
on-device (the one verification step that could never be done in this
sandbox, since it has no Xcode/macOS toolchain or real Secure Enclave).

Fix 4 (the logout soft-lock behavior above) was found during that
on-device testing and lives on its own branch,
`fix/ios-biometric-logout-soft-lock`, based on the current `main`
(`52d8eab`) — not on the now-merged `feature/ios-biometric-login`. It's a
small, self-contained, already-verified change (see the verification table
below); whether to merge it directly or open it as its own PR for a fresh
CI run first is the repository owner's call, since this environment has no
push/PR/merge access to the repository either way.
