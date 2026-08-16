# Shift notification: surfacing a platform failure instead of swallowing it

Branched off `main` after `feature/ios-shift-notification` merged (PR #19,
commit `546d51c`) — this is a follow-up fix, not part of that original
branch. See `docs/shift-notification-handoff.md` (the original feature) and
`docs/shift-notification-settings-toggle-handoff.md` (the on/off Settings
toggle) for everything this builds on.

## What happened

After the toggle shipped and TestFlight build 8 was installed on a physical
device, the repository owner started a shift, was shown and accepted the
native "WagesTracker Would Like to Send You Notifications" permission
prompt, and — nothing appeared in the notification center or on the lock
screen. Every piece of the wiring was re-checked from the JS call site
through to `ShiftNotificationPlugin.swift`'s `AppDelegate` registration, the
Xcode target membership, and the `MainViewController.capacitorDidLoad()`
plugin-instance registration, and all of it was correct — this is the same
pattern `BiometricAuthPlugin` already uses successfully in production. Two
non-bugs were ruled out first: a stale build (the web bundle Xcode packages
is git-ignored and only updated by `npm run ios:sync`, but the repository
owner has no Mac, so every build actually goes through the
`ios-testflight.yml` GitHub Actions workflow, which always runs `ios:sync`
fresh — confirmed against the Actions run history), and a shift that was
already open before the update (the notification only posts from
`useTodayShift.start()`, never retroactively — confirmed the shift in
question was started fresh, after updating, with permission granted at that
exact moment).

With those ruled out, and no Mac available on either side to attach Xcode's
console or Safari's Web Inspector to the device, there was no way left to
see *why* it was failing — only that it was. `postShiftStartedNotification`
already had a real answer to "why," it just never told anyone:
`NativeShiftNotificationAdapter.postShiftStarted` catches every plugin
failure and only `console.error`s it (see `platform/nativeShiftNotifications.ts`,
unchanged by this fix), and `useTodayShift.start()` calls it with a bare
`void`, discarding the outcome entirely. Deliberately so, by design — a
notification failure must never block or unwind a shift that already
started successfully — but "never blocks" had been implemented as "never
observable," which are not the same requirement. Nothing in the app could
tell the difference between "permission was never granted" and "granted,
scheduled, and then dropped by the OS for some Keychain/authorization
reason neither of us could see."

## The fix

`ShiftNotificationAdapter.postShiftStarted` now resolves to a
`ShiftNotificationResult` (`{ ok: true } | { ok: false; error: string }`)
instead of `void` — still never throwing (the try/catch in
`NativeShiftNotificationAdapter` is unchanged), just reporting what it
caught instead of only logging it. `WebShiftNotificationAdapter` always
resolves `{ ok: true }` (it's already a no-op). `useTodayShift.start()`
still fires the call the same fire-and-forget way — nothing here adds a
delay or a dependency the shift-start button waits on — but now chains a
`.then()` off it that reports an `ok: false` result through a new
`shiftNotificationNotice` on `AppContext`, plus a `.catch(() => {})` so a
pathological adapter that violates its own "never throws" contract still
can't produce an unhandled promise rejection.

`shiftNotificationNotice` is deliberately its own piece of state, not a
reuse of `actionError`. `actionError` renders in `StatusBanner`'s `danger`
tone (`role="alert"`) — right for "the save you asked for failed," wrong
here, since the shift itself already started successfully; only the
reminder didn't show up. It renders instead in `warning` tone
(`role="status"`), the same tone the existing "You're offline" banner uses,
dismissible via a `dismissShiftNotificationNotice` setter that mirrors
`clearActionError`'s shape exactly. `App.tsx` renders it in the same
`app-shell-banner` block as the other three notices, following the existing
`!connected` / `sessionNotice` / `actionError` pattern precisely — no new
banner component, no new placement logic.

## Why this is a real, permanent fix and not just a debugging aid

It was written to answer the immediate question (why isn't anything
showing up), but it isn't a temporary instrumentation hack pulled back out
afterward — a silently-failing "remember to sign out" reminder is a real
gap in the shipped feature regardless of how it was discovered. Before this
change, a person who denied the permission prompt, revoked it later in iOS
Settings, or hit any other platform failure had absolutely no way to know
their reminder wasn't working short of noticing its absence and guessing
why. Now they see, in-app, in plain language, exactly what went wrong —
without needing a Mac, Xcode, or the Console app.

## What this deliberately does not change

- The "never blocks/delays shift start" guarantee — the notification call
  is still fully fire-and-forget from the button's perspective; only what
  happens *after* it settles changed.
- `NativeShiftNotificationAdapter`'s own try/catch and `console.error` —
  both still happen exactly as before, this only adds a second reporting
  path on top.
- Everything about *why* a given failure happens — this makes a failure
  visible, it does not fix any particular platform-level cause. The actual
  root cause behind the repository owner's specific device is still
  unknown as of this fix; the banner's `error` field is deliberately the
  raw underlying message (e.g. `NSError.localizedDescription` from a failed
  `SecItemAdd`, or `UNError`'s description from a failed
  `UNUserNotificationCenter.add`), unparaphrased, so the next report of
  this includes the actual diagnostic instead of another "nothing shows
  up."

## Testing

`platform/__tests__/nativeShiftNotifications.test.ts` gained coverage that
a native failure now resolves `{ ok: false, error }` (both for a thrown
`Error` and for a non-`Error` throw, exercising the `String(error)`
fallback) rather than only being logged, plus a check that success still
returns `{ ok: true }`. `platform/__tests__/shiftNotifications.test.ts`
updated its web-default and `configureShiftNotifications` fixtures to the
new contract. `lib/__tests__/useTodayShift.notifications.test.tsx` gained
two cases: `reportShiftNotificationIssue` is called with the exact expected
sentence on `ok: false`, and is never called on `ok: true`. A new
`context/__tests__/shiftNotificationFailureNotice.test.tsx` exercises the
whole path through the real `<App/>` — log in, start a shift, and assert
the banner text appears in `warning` (not `danger`) tone, never appears on
success, and is dismissable — following the same reasoning
`context/__tests__/deviceLimitNotice.test.tsx` already established for this
codebase: a value that's computed on `AppContext` but never actually
rendered is exactly the failure class worth guarding against directly,
not just asserting at the context-state level. Every other test file that
mocked `postShiftStartedNotification`'s resolved value (`biometricIdleExemption.test.tsx`,
`biometricSessionUpgrade.test.tsx`, `shiftNotificationReconciliation.test.tsx`,
`useShiftNotificationSetting.test.tsx`) was updated to resolve `{ ok: true }`
instead of `undefined`, matching the new return type, even where that
mock is never actually exercised by the test's own flow.

Verified against pre-fix code via `git stash` (toggling `App.tsx`,
`AppContext.tsx`, `lib/useTodayShift.ts`,
`platform/nativeShiftNotifications.ts`, and `platform/shiftNotifications.ts`
back to their pre-fix, on-`main` state while keeping the new/changed
tests): the reverted source fails to typecheck against the updated tests
at all (`Promise<{ ok: boolean }>` is not assignable to `Promise<void>`),
and running the affected suites anyway (bypassing `tsc`) fails 7 of 28
relevant tests. Restored and re-verified passing afterward.

## Full verification, this revision

| Check | Result |
|---|---|
| Frontend tests | **596/596 passed**, 69 files (was 590 before this change; +6) |
| Frontend typecheck | clean |
| Frontend build | clean |
| `npm audit` | **0 vulnerabilities** |

Backend and the native Swift plugin are both untouched by this change —
this is a pure frontend fix (the contract between the JS adapter layer and
`useTodayShift`/`AppContext`), so neither the backend suite nor any new
Xcode/Simulator verification is required beyond confirming this diff
doesn't touch either.
