# Wages Tracker 1.22.0

Source/web release and iOS TestFlight beta, recorded **11 October 2026**.

## Highlights

- **Consistent product name:** Wages Tracker across the application, native home-screen label, PWA, PDF reports, and email messages. The existing bundle ID and App Store identity are preserved.
- **Premium monochrome branding:** approved graphite/obsidian time-to-pay artwork, theme-aware app icons, launch assets, and shared web branding.
- **Settings and About:** developer credit moved to the Settings overview, with GitHub/portfolio links, build metadata, and an automatically updating copyright year. About contains dedicated Privacy Policy and Support rows.
- **App Store update prompts:** actual Installed → Latest versions, Update now opening the existing listing, and Not now postponing reminders for 48 hours across launches. Prompts stop when the installed version catches up and detect future public releases automatically.
- **Smart Shift Reminders:** reliable weekday learning from existing completed history, roster-change adaptation, explicit action confirmation, and a clearer preference/status experience.
- **Native Live Activity:** refined elapsed-time and hourly-chart presentation, accessible layouts, and reliable scoped shift clock-out behavior.
- **Reports and history:** responsive trend/comparison charts, improved work-location grouping and history calendar behavior, date filtering, and refreshed report/PDF data.
- **Account and interface polish:** clearer signup email validation, confirmed changes to an existing email, streamlined Profile & preferences, responsive admin layouts, and friendlier user-facing messages.

These notes cover the source changes since the previous GitHub release, v1.20.2. Some of those changes already shipped in the public 1.21.0 iPhone release.

## Delivery status

| Channel | Verified result |
| --- | --- |
| Application source | [PR #73](https://github.com/Ezaz-Ahmad/WagesTracker/pull/73) merged into protected main |
| Web | Vercel deployment succeeded |
| iOS beta | **1.22.0 (50)** passed Apple validation and was accepted for TestFlight upload |
| Public App Store | The [Australian listing](https://apps.apple.com/au/app/wagestracker/id6801702467) still shows **1.21.0**, published 25 September 2026, as checked on 11 October 2026 |

**Uploaded source:** [399176d8e48608382376b1e77e9f66e9aa07597e](https://github.com/Ezaz-Ahmad/WagesTracker/commit/399176d8e48608382376b1e77e9f66e9aa07597e)

**Signed delivery:** [GitHub Actions run 38112108372](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38112108372), fresh dispatch number 50, attempt 1. Apple returned validation and upload success without errors at 04:41 UTC on 11 October 2026. Temporary signing material and the signed IPA were removed from the runner.

Apple processing and tester availability were not independently verified after upload. Install through TestFlight once processing and tester assignment permit it, then complete the physical-device checklist in the [delivery guide](ios-testflight-delivery.md). This source release does not submit App Review or publish a new public iPhone version.

## Update-reminder rollout

The native checker compares marketing versions numerically and accepts only the matching public App Store/bundle identity. Equal versions and TestFlight versions ahead of the public release remain silent; offline lookup failures do not interrupt the app.

Not now preserves a full 48-hour snooze even if another release appears. At the deadline, the next foreground check refreshes Apple's catalog and shows a prompt only if the app is still behind.

Existing public 1.21.0 installations first need an ordinary App Store update to acquire the checker. The App Store Connect listing name also needs to be changed to Wages Tracker with the next public review submission. See [App Store update behavior](app-store-updates.md).

## Verification

- 294 backend tests, 853 frontend Vitest tests, and 3 Universal Link generator tests: **1,150 tests** in the full automated test gate.
- 14 production-browser smoke scenarios in frontend PR CI.
- 8 distribution-entitlement regression tests.
- 40 native Live Activity layouts in macOS Simulator CI.
- Type checks, normal/native production builds, brand asset verification, Capacitor/plugin/runtime checks, and JavaScript/TypeScript, Actions, and Swift CodeQL passed for the uploaded application source.
- Production API health and the literal Team ID in the Universal Link association file were checked before dispatch.
- Signed app/extension profiles, exported metadata/entitlements, Apple validation, upload, and credential cleanup passed in the signed workflow.

Physical Face ID/Touch ID, Mail Universal Links, real-mail recovery, background behavior, and device installation results require the separately recorded iPhone checks.

**Full changelog:** [v1.20.2 → v1.22.0](https://github.com/Ezaz-Ahmad/WagesTracker/compare/v1.20.2...v1.22.0)
