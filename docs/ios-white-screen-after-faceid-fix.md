# Blank white screen after a successful Face ID unlock on a cold backend

Branched off `fix/ios-shift-notification-visibility`, alongside the
account-scoping fix in `docs/biometric-account-scoping-fix.md`.

## What happened

Reported by the repository owner: after unlocking with Face ID while the
Render backend was cold (spun down from inactivity), the screen went
completely blank/white instead of showing the "waking the server up" screen
that a *password* login already shows correctly in the same situation.

`App.tsx`'s `Root()` decides whether to show `WakingUpScreen` using
`status === "loading" && !biometricBusy`. `biometricBusy` is deliberately
scoped to cover the *entire* `attemptBiometricAuthentication` operation in
`AppContext` — both the native Face ID/Touch ID system prompt itself *and*
the subsequent `api.fetchMeWithToken()` call that re-validates the
recovered token against the backend — because that's the right scope for
disabling buttons/showing "Confirming…" in the UI. But `Root()` was reusing
that same flag to suppress `WakingUpScreen`, which meant the screen stayed
suppressed for the *network wait* too, not just the moment the native
system sheet is actually on screen. Once Face ID succeeded and the system
sheet dismissed, there was genuinely nothing on screen for however long the
cold Render instance took to answer — the bug.

## The fix

A new, narrower `biometricPromptActive` flag on `AppContext`, true only
while the `authenticateWithBiometrics()` call itself is in flight (wrapped
in a `try/finally` around just that call, inside
`attemptBiometricAuthentication`) — not the `fetchMeWithToken()`
re-validation that follows a successful prompt. `Root()`'s `isWaiting`
computation now excludes `biometricPromptActive` instead of the wider
`biometricBusy`, so `WakingUpScreen` is free to show (after its existing
500ms grace delay) once the native prompt itself is done, even while the
backend re-validation is still pending. The screen still stays correctly
blank for the brief window the system sheet itself is up, since showing
"Getting Wage Tracker ready" underneath an active Face ID prompt would be
misleading.

## Testing

A new test in `context/__tests__/biometricLogin.test.tsx` ("shows the
waking-up screen (not a blank one) while the post-unlock backend
re-validation is still in flight") drives the real `<App />` with a
biometric `authenticate()` call that resolves successfully while
`fetchMeWithToken()` is held pending, and asserts `WakingUpScreen`'s
"Getting Wage Tracker ready" heading appears. Proven against the pre-fix
`App.tsx` via `git stash`: the pre-fix render left `<body><div /></body>`
— confirmed genuinely blank, not just a different message.
