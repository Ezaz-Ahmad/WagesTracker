# Wage Tracker 1.19.0 — motion and interaction production candidate

**Candidate date:** 29 August 2026
**Marketing version:** 1.19.0
**TestFlight build:** assigned by the next protected `main` workflow dispatch

## What changed

- Introduced one shared motion scale: 90ms immediate feedback, 140–180ms micro-interactions, 180–260ms panels and up to 320ms full-screen transitions.
- Standardised asynchronous buttons across authentication, recovery, Settings, Entry, Spending, reports, sessions, biometric settings, administration and account deletion. Buttons disable immediately, keep their dimensions stable, expose `aria-busy`, announce a meaningful busy label and delay only the compact spinner for 120ms so fast responses do not flash.
- Made Home's Week at a glance chart fully selectable by touch, keyboard and assistive technology. The selected day reveals date, active status, hours, earnings, shift count, fuel and branches; live values update without replaying the entire entrance animation.
- Limited the subtle Live badge to three genuinely changing visualisations: Home week bars, Report weekly trend and Spending cash flow. Historical/static cards no longer show it.
- Paused the shared live clock while the document is hidden, then caught up accurately on return without retaining unnecessary timers.
- Kept live currency and hour values tabular and stable so additional digits do not move surrounding content.
- Routed Privacy and Support inside the still-mounted application. Login drafts and authenticated screen state survive the transition; return focus and multi-page history are restored correctly.
- Gave public/internal and GitHub/Portfolio external links consistent touch, hover, pressed, focus and secure external-destination treatment.
- Expanded reduced-motion coverage and ensured chart information, loading states and selected/live states remain understandable without animation or colour alone.

## Verification completed locally

- Backend tests: 280 passed.
- Frontend component/integration/accessibility tests plus association-file tests: 689 expected after the final additions; rerun the committed branch gates for the authoritative count.
- TypeScript checks: backend and frontend passed.
- Desktop and 360px-wide in-app browser checks: state-preserving Privacy/Support navigation, focus restoration, no horizontal overflow and no captured browser warning/error.

## Release gates that remain external

Windows cannot run `xcodebuild`, an iOS Simulator or a physical TestFlight installation. After this candidate is merged:

1. Update the protected `testflight` environment variable `IOS_APP_VERSION` to `1.19.0`.
2. Confirm the pull-request macOS unsigned iOS Simulator check is green.
3. Dispatch **iOS TestFlight Delivery** from protected `main`; record the workflow-generated build number and accepted commit.
4. Install that exact build on a physical iPhone and complete the motion, slow-network, background/resume, rotation, keyboard and repeated-navigation checklist in `docs/ios-testflight-delivery.md`.
5. Do not submit to App Review until those device checks pass.
