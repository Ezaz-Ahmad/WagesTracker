# Face ID/Touch ID: scoping "enabled" to the account that actually turned it on

Branched off `fix/ios-shift-notification-visibility` (which itself branched
off `main` after PR #19 merged) — a follow-up fix, not part of the original
`feature/ios-biometric-login` work. See `docs/biometric-login-handoff.md`
for the feature this builds on.

## What happened

Reported directly by the repository owner: with Face ID enabled for their
main account, logging into a different ("testing") account on the *same
device* showed the Face ID toggle in Settings as already on — for an
account that had never turned it on — and tapping the login screen's Face
ID icon while the testing account's email was typed in actually
authenticated and signed in as the *main* account instead.

This was a known, deliberate design tradeoff from the original feature,
called out explicitly in `BiometricAuthPlugin.swift`'s own doc comment:
"single account slot by design... enabling biometrics for a different
account overwrites whatever was there." The plugin only ever stores one
Keychain credential at a time — there's no in-app account switcher, so this
was a reasonable simplification when written. What it didn't account for is
exactly the scenario reported here: the device *shows* biometrics as "on"
for whichever account is currently signed in, when it's actually only on
for whichever account's credential happens to occupy the one slot. Every
layer of the stack — `nativeBiometricAuth.ts`, `biometricAuth.ts`,
`AppContext`, `AuthScreen`, `BiometricLoginSettings` — trusted
`biometricStatus.enabled` directly with no account comparison at all.

## The fix

Rather than redesign to true multi-account Keychain storage (still no
account switcher to justify that complexity), the stored metadata now
includes the account's `email` alongside `accountId`/`accountLabel`, and
every surface that would otherwise present "enabled" as an account-level
fact now compares it against the account actually in view before trusting
it — failing closed (treating it as *not* enabled) on any mismatch:

- **`BiometricAuthPlugin.swift`** — `enable()` now requires `email` (a new
  required argument; rejects with `invalid_argument` if missing) and stores
  it in the (non-biometry-gated) metadata Keychain item. `isEnabled()`
  returns it alongside the existing fields. The underlying single-slot
  storage design is unchanged — this is metadata, not a second credential
  slot.
- **`AppContext.tsx`** — a new derived `isBiometricEnabledForCurrentUser`
  (`biometricStatus.enabled && !!user && biometricStatus.accountId ===
  user.id`) is the value Settings now reads instead of the raw
  device-level flag. `accountId` is used here (not email) since it's
  stable and can't be mistyped.
- **`BiometricLoginSettings.tsx`** — shows the toggle as off for an account
  that doesn't own the current credential, with a new hint explaining
  another account currently has it on and that turning it on here will
  replace that.
- **`AuthScreen.tsx`** (logged-out, pre-authentication) — there's no
  `user.id` to compare against yet, so this compares the stored
  credential's `email` against whatever's currently typed/remembered in
  the email field (case-insensitive, trimmed). An empty typed field still
  offers the icon (preserves the original single-account convenience —
  nothing to conflict with yet); once a *specific*, different email is
  typed, the icon disappears.

**Migration note, called out deliberately rather than swallowed:** a
credential enabled *before* this fix has no `email` in its stored metadata,
so Swift reports it as `email: ""`, which never equals a real typed email.
Anyone who already had Face ID on will see it stop offering itself the
next time a different (or even the same, once something is typed) email is
entered, until they re-enable it once. This is treated as an acceptable,
one-time cost of closing a real cross-account authentication bug, not a
regression to work around.

## Testing

Face ID hardware can't run in this sandbox, so as with the original
feature, coverage is at the JS boundary: `BiometricLoginSettings.test.tsx`
now covers the "different account has it on" hint and confirms the toggle
reads off `isBiometricEnabledForCurrentUser`, not the raw device flag;
`AuthScreenBiometric.test.tsx` adds a dedicated `describe("account-mismatch
handling")` block covering the icon hiding once a different email is
typed, staying visible for a matching email (case/whitespace-insensitive),
and hiding for a pre-fix credential with no stored email once anything is
typed. Every new/changed test was proven to fail against the pre-fix
source (via `git stash` isolating just the source files) and pass again
once restored.
