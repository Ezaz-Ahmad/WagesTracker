# Shift-in-progress notification: temporarily paused

Branched off `fix/ios-shift-notification-visibility`, in the same phase as
the biometric account-scoping and white-screen fixes.

## What happened

Despite the delivery-visibility fix in
`docs/shift-notification-failure-visibility-handoff.md` (which made a
platform failure surface as a banner instead of only a `console.error`),
the repository owner tested on a physical device, accepted the
notification permission prompt, and still saw nothing appear in the
notification center or on the lock screen — with no `ok: false` banner
either, suggesting the adapter itself believes it succeeded. Rather than
keep shipping a Settings toggle and a background-posting path for a
feature that isn't reliably working for at least one real user, the
repository owner asked for it to be turned off for now, to be revisited
later, without losing the implementation work already done.

## The fix

A single master kill-switch, `isShiftNotificationFeatureEnabled()` /
`setShiftNotificationFeatureEnabledForTesting()` in
`platform/shiftNotifications.ts`, defaulting to `false`. Two integration
points check it:

- **`useTodayShift.ts`'s `start()`** — now requires
  `isShiftNotificationFeatureEnabled()` (in addition to the existing
  per-device `isShiftNotificationEnabled()` preference check) before ever
  calling `postShiftStartedNotification`. With the flag off, starting a
  shift never attempts to post a notification at all.
- **`ShiftNotificationSettings.tsx`** — renders nothing at all while the
  flag is off, alongside its existing web/PWA gating, so Settings → Security
  no longer offers a control for a feature that's currently a no-op.

Nothing else changed: the native Swift plugin, the adapter contract, the
per-device preference storage, and the pending-end-shift background
recovery flow are all untouched and fully intact. **Resuming later is a
one-line flip** of the flag's default back to `true` in
`platform/shiftNotifications.ts` — no other code needs to change, and any
per-device preference someone had already set takes effect again
immediately.

## Testing

Existing tests exercising the real (still fully implemented) posting/toggle
behavior — `useTodayShift.notifications.test.tsx`,
`ShiftNotificationSettings.test.tsx`, and
`shiftNotificationFailureNotice.test.tsx` — now explicitly force the flag
on via the test-only setter/mock, so this dormant code path stays covered
even while it's off by default in production. Two new tests prove the
kill-switch's own effect: `useTodayShift` never posts while the flag is
off even with the per-device preference on, and `ShiftNotificationSettings`
renders nothing while the flag is off even natively with the preference on.
Both were proven to fail against the pre-fix source via `git stash` and
pass again once restored.
