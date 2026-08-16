# Shift notification on/off toggle — architecture and verification

Lives on `feature/ios-shift-notification`, stacked the same way as the rest
of this branch — see `docs/shift-notification-handoff.md`'s "Branch
strategy" section, which applies identically here. This is a direct
follow-up to the shift-in-progress notification feature that same doc
covers: same working session, requested by the repository owner right after
the 5-year biometric session extension above, in the same message.

## The request

"there should be an option in the settings from where user can turn on or
off this feature" — the shift-in-progress notification (a persistent
notification with a "Sign out" action, described in
`docs/shift-notification-handoff.md`) shipped with no way to turn it off
short of denying the app notification permission at the OS level. This adds
a proper in-app control for it.

## Design

**The preference itself** (`isShiftNotificationEnabled`/
`setShiftNotificationEnabled` in `frontend/src/platform/shiftNotifications.ts`)
is a plain `localStorage` boolean, device-local and never synced to the
backend — the same category of preference as the remembered-email
convenience already in `lib/api.ts`. It defaults to **on**: the key's mere
absence (every existing install, and any fresh one) reads as enabled, so
shipping this toggle doesn't silently take away a notification people were
already relying on — only an explicit "off" write is ever persisted, and
turning it back on removes the key entirely rather than writing "on", since
there's nothing meaningful to distinguish "never touched" from "explicitly
re-enabled."

**`useTodayShift`'s `start()`** now checks `isShiftNotificationEnabled()`
alongside its existing "is there a token to hand the native layer" check,
before ever calling `postShiftStartedNotification`. This is a client-side
gate deliberately placed at the call site, not inside the adapter itself —
a disabled preference means the call is never attempted at all, rather than
being silently swallowed somewhere downstream where a future reader might
mistake it for a bug.

**Settings UI** (`frontend/src/settings/ShiftNotificationSettings.tsx`) is a
single toggle button, placed directly under `BiometricLoginSettings` on the
Security page — the two are the closest existing precedent (both native-iOS-only,
both about what this specific device does around a stored session
credential) and the repository owner had specifically asked for it "near
the existing Biometric login section" in an earlier message. It's gated by
`Capacitor.isNativePlatform()` exactly like `BiometricLoginSettings`: the
underlying feature doesn't exist on web/PWA (`WebShiftNotificationAdapter`
is already a no-op), so there's nothing for the control to toggle there.

**Scope decision: future shifts only, not retroactive.** The obvious richer
version of this toggle would reach into the currently-open shift (if any)
and immediately post or clear its notification the moment the preference
changes — matching what turning biometric login on/off already does for its
own session state. That was tried first (`useShiftNotificationSetting`
originally called the full `useTodayShift()` hook, including `shifts`,
`today`, and `useConfirm()`) and reverted, for two concrete reasons
discovered while testing it, not just a hunch:

1. **It's not actually a safety boundary.** Unlike biometric protection
   (where a stale session left idle-exempt after being turned off is a real
   security regression — see `docs/biometric-5-year-session-handoff.md`),
   the shift notification's "Sign out" action doesn't cross any new trust
   boundary the app didn't already accept when the shift started (see
   "Credential storage" in the main shift-notification doc). A lingering
   notification for an already-open shift is a UI staleness issue, not a
   security one — there's no correctness reason to force it away
   immediately rather than letting it clear itself the normal way once that
   shift ends.
2. **It broke real, unrelated tests.** Once `ShiftNotificationSettings`
   depended on `useTodayShift()` (which needs `today`, `shifts`,
   `createShift`, `updateShift`, and `useConfirm()` — none of which this
   toggle actually uses), rendering the Security page in any test whose
   `useApp()`/context fixture didn't happen to include shift/today data
   started crashing — `SettingsScreen.test.tsx` and `settings/__tests__/a11y.test.tsx`
   both failed this way the first time this was implemented (`isoDate`
   called on an `undefined` `today`, then `findOpenShift` called on a
   non-array `shifts`). That's a real signal, not just an inconvenient test:
   a Settings toggle whose only job is "flip a preference" had quietly
   become dependent on the entire shift-tracking subsystem being fully
   initialized just to render its own card. `useShiftNotificationSetting`
   was rewritten to be a plain `useState`/`localStorage` pair with no
   `useApp()` dependency at all, which is both simpler and no longer
   coupled to shift state it was never conceptually about.

The Settings copy makes this scope explicit rather than leaving it to be
discovered: the "off" state reads "Turned off for shifts you start from now
on... A shift already in progress keeps whatever notification it already
posted until it ends."

## What this deliberately does not change

- The notification's own behavior while enabled — posting, the "Sign out"
  action, background reconciliation — none of that is touched; this is
  purely a gate in front of whether `start()` calls it at all.
- `end()`'s `clearShiftNotification()` call — unconditional, on purpose:
  ending a shift should always try to clear whatever notification might be
  showing, regardless of the current preference, since a stale notification
  for a shift that's already over would be actively wrong, not just
  unwanted.
- The backend — nothing here touches any API route; this is a fully
  client-side preference.

## Testing

`frontend/src/platform/__tests__/shiftNotificationPreference.test.ts`
(new, jsdom, real `localStorage`) covers the preference functions directly:
default-on, explicit on/off, persistence across reads, and that turning it
on removes the key rather than writing an explicit value.
`frontend/src/lib/__tests__/useShiftNotificationSetting.test.tsx` (new)
covers the hook: reflects the stored value on mount, persists a flip via
`setShiftNotificationEnabled`, survives repeated toggling, and — the
regression guard for the coupling bug described above — never calls
`postShiftStartedNotification`/`clearShiftNotification` itself.
`frontend/src/settings/__tests__/ShiftNotificationSettings.test.tsx` (new)
covers the component in isolation (native-only rendering, on/off copy and
label, calling `setEnabled` with the right value), mocking the hook
directly. `frontend/src/lib/__tests__/useTodayShift.notifications.test.tsx`
gained one case: `start()` does not post when the preference is off, added
alongside its existing "no token" case since both are now checked by the
same `if`.

Every new/changed test was run against the pre-fix code via `git stash`
(toggling `useTodayShift.ts`/`shiftNotifications.ts`) and confirmed to fail
first: 10 of 21 relevant tests failed against the reverted source in the
final, corrected version of this change (the rest were either pre-existing
baseline cases in `useTodayShift.notifications.test.tsx` that correctly
still passed, or `ShiftNotificationSettings.test.tsx`'s cases, which mock
the hook directly and so can't distinguish the two versions of it — that
file's coverage is proven instead by the component simply not having
existed before this change at all). The coupling regression itself (the
`SettingsScreen.test.tsx`/`a11y.test.tsx` crashes) was caught by the
project's own full test suite during this same verification pass, not
written as a targeted regression test — it was a genuine bug in an earlier
version of this change, found and fixed before it reached the branch, not a
coverage gap being reported after the fact.

## Full verification, this revision

| Check | Result |
|---|---|
| Frontend tests | **590/590 passed**, 68 files (was 575 before this change; +15) |
| Frontend typecheck | clean |
| Frontend build | clean |
| `npm audit` | **0 vulnerabilities** |

Backend is untouched by this change, so its own suite (214/214, unaffected)
wasn't rerun as part of verifying this specific revision beyond confirming
nothing in this diff touches it. Like the rest of the shift-notification
feature, the native Swift side isn't touched by this change at all — it's
a pure frontend gate in front of an existing, already-Swift-verified
notification call — so there's no new Xcode/macOS-toolchain verification
gap here either.
