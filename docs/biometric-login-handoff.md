# Biometric login (Face ID / Touch ID) — architecture, security, and verification

Branch: `feature/ios-biometric-login` (PR #17, draft), based on `main` at
`9185368` — the confirmed `v1.16.0` TestFlight release-candidate commit. Not
merged. Targets `v1.17.0`, after `v1.16.0` ships; does not change the app
version, does not touch the TestFlight workflow, and does not affect the
`v1.16.0` release candidate in any way (see the confirmation at the bottom).

This revision addresses two blocking issues found in review of the first
version of this PR — both are fixed here, with regression coverage for each:

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

## Full verification, this revision

| Check | Result |
|---|---|
| Backend tests | **200/200 passed**, 20 files |
| Frontend tests | **533/533 passed**, 59 files (previously 532; +1 for the Remember Me regression test) |
| — of which, biometric-specific | **50/50 passed** across 5 files (49 from the first revision + the new Remember Me test) |
| Backend typecheck | clean |
| Frontend typecheck | clean |
| Backend build | clean |
| Frontend build | clean |
| `npm audit` | **0 vulnerabilities** |
| `verify:libsql` | passed |
| `verify:capacitor` (JS/Swift version alignment) | passed — 8.4.2 on both sides |
| **`verify:ios-plugin-registration`** (new) | passed — plugin compiled, registered, storyboard wired |
| `verify:capacitor:bundle` (one Capacitor runtime in the shipped bundle) | passed, against a real `ios:build:web && cap copy ios` output |
| `ios:assets:verify` | passed — 11 files, unchanged |
| `ios:testflight:verify` | passed — manual-trigger-only, off `main`, signing safeguards intact, unmodified by this branch |

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

- `main` is still at `9185368`; this branch contains no commits touching
  `main` and has not been merged.
- No version number changed: `frontend/package.json`, `MARKETING_VERSION`
  in `project.pbxproj`, and `CFBundleVersion` in `Info.plist` are all
  unchanged from `main`.
- No TestFlight workflow file changed; `ios:testflight:verify` passed
  against the unmodified workflow.
- No signing certificate, `.p8`/`.p12`, provisioning profile, or
  environment-secret material was read, written, or referenced anywhere in
  this branch.

## Process note: replacing the previous handoff document

The first revision of this PR's description linked to
`HANDOFF-ios-biometric-login.md`, delivered directly to the repository
owner's machine rather than committed to the branch — a real gap the review
correctly flagged: nobody looking at the PR on GitHub could see it. This
document replaces it, lives at `docs/biometric-login-handoff.md`, and is
part of this branch's actual history. The PR description itself should be
updated to reference this file's path instead (`gh pr edit 17 --body-file
docs/biometric-login-handoff.md`, or edit the description directly on
GitHub) — that's a step the repository owner needs to take, since this
environment has no push/PR-edit access to the repository.

## What's left before this can merge

Per the review: this PR stays a **draft** until these two fixes are
confirmed (this revision's CI run, and ideally a physical-device Face
ID/Touch ID test), merges only after the `v1.16.0` testing/release
checkpoint is complete, and after merging, a new `v1.17.0` TestFlight build
should be created and tested on a physical Face ID-capable iPhone before
wider release.
