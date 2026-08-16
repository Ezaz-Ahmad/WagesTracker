# Mobile welcome/intro screen

Branched off `fix/ios-shift-notification-visibility`, in the same phase as
the biometric account-scoping, white-screen, and notification-pause fixes.

## What happened

Requested directly by the repository owner, with two reference screenshots
of a dark-themed intro screen ("WAGE TRACKER" kicker, "Track your hours.
Know your worth." headline, three feature bullets, a "This week $647.50"
stats card) asking for something similar before login, dismissible with a
swipe, that should "look smooth and professional." Two open design
questions were resolved directly with the repository owner beforehand:
single full-screen intro with swipe-up-to-continue (rather than a
multi-page carousel), and shown every time before login — including after
every logout, not just the very first install.

Investigating first turned up that this content essentially already
existed: `AuthScreen.tsx` already had a `.landing-hero` panel with this
exact copy (`FEATURES` array, `LandingPreviewCard`'s animated stats card),
but it was CSS-gated to `display: none` below a 960px viewport width (see
`styles/landing.css`) — built for desktop/wide-viewport marketing, and
never shown at all on a narrow/native-iOS viewport, which is exactly the
gap this request asks to fill.

## The fix

- **`components/LandingHero.tsx`** (new) — the shared marketing copy
  (`LANDING_FEATURES`, `LandingPreviewCard`, and a `LandingHeroContent`
  wrapper) extracted out of `AuthScreen.tsx` so both surfaces render
  identical content and can't drift apart. `AuthScreen.tsx`'s own hero
  panel now just renders `<LandingHeroContent />` inside its existing
  shell/decorative-shapes markup — no visual change on desktop.
- **`screens/WelcomeScreen.tsx`** (new) — a full-screen, mobile-only intro
  reusing `LandingHeroContent`, dismissible via an always-present "Get
  started" button (the real, accessible dismissal path) and, as a
  progressive enhancement, a one-finger swipe-up gesture
  (`lib/useSwipeUp.ts`, new — mirrors the existing `usePullToRefresh`
  hook's native-touch-listener approach for the same reason: React's
  synthetic touch handlers are passive by default). Only visible below the
  same 960px breakpoint `AuthScreen`'s own hero panel uses (see
  `styles/landing.css`'s new `.welcome-screen` rules) — at that width the
  hero is already permanently visible beside the login form, so a
  full-screen intro in front of it would just be a redundant extra step.
- **`App.tsx`'s `Root()`** — a local `welcomeDismissed` state, reset to
  `false` every time `status` freshly becomes `"loggedOut"` (covers both
  the very first cold launch and every later logout), gates rendering
  `WelcomeScreen` in front of `AuthScreen` whenever `status === "loggedOut"
  && !welcomeDismissed`.

## Testing

`screens/__tests__/WelcomeScreen.test.tsx` covers the component directly:
same headline/feature copy as the desktop hero, `onContinue` firing on a
button click, full keyboard operability (focus + Enter), and the swipe
hint being excluded from the accessibility tree since the button already
covers the same action. `WelcomeScreen` was also added to the existing
`screensA11y.test.tsx` axe/heading-structure sweep alongside the app's
other screens.

`context/__tests__/welcomeScreen.test.tsx` covers the actual placement
end-to-end through the real `<App />`: shows before the login form on a
cold logged-out launch, reveals the login form once dismissed, doesn't
reappear on its own while just switching login/signup mode, reappears
after logging out (not just on the first launch), and never appears once
actually logged in. Existing full-`<App />` integration tests
(`biometricLogin.test.tsx`, `deviceLimitNotice.test.tsx`,
`shiftNotificationFailureNotice.test.tsx`) were updated to dismiss the
welcome screen before reaching the login form they already exercised,
since it's now genuinely in front of it in the real flow.

All new/changed tests were proven to fail against the pre-fix source (via
`git stash` isolating just the new/changed source files) and pass again
once restored.
