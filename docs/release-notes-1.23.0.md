# Wages Tracker 1.23.0

Optional tab visibility, source/web release and iOS TestFlight beta, recorded **11 October 2026**.

## Changes

- Hide or restore Home, Entry, Spending, Report, and History under **Settings → Profile & preferences → App layout → Tab bar**, alongside the existing ordering controls.
- Review a concise confirmation before hiding each tab. It explains which tools leave the menu, preserves saved records, and states that wage calculations continue unchanged.
- Keep Settings available for recovery. Hidden tabs disappear from mobile menus, desktop navigation, and swipes; launch and cross-window changes choose an available screen.
- Warn when hiding the remaining in-app shift controls, including how to restore them. An active shift continues running.
- Hide the Home spending snapshot together with Spending, then restore the previous widget preference when the tab returns.
- Save preferences per account on the device, preserving older saved layouts. Reset restores every tab and its default order.
- Match existing dark/light styling, keyboard focus, reduced motion, touch targets, and responsive layouts.

See [tab visibility behavior](tab-visibility.md) for the full impact and recovery details. No backend schema, wage calculation, native plugin, or dependency change is included.

## Delivery

| Channel | Verified result |
| --- | --- |
| Application source | [PR #76](https://github.com/Ezaz-Ahmad/WagesTracker/pull/76) merged into protected main |
| Web | Vercel production deployment succeeded from the uploaded source |
| iOS beta | **1.23.0 (51)** passed Apple validation and was accepted for TestFlight upload |
| Public App Store | The Australian listing still shows **1.21.0**, checked on 11 October 2026 |

**Uploaded source:** [98d376a0609a1471035cab88ea73c88542ec3acf](https://github.com/Ezaz-Ahmad/WagesTracker/commit/98d376a0609a1471035cab88ea73c88542ec3acf).

**Signed delivery:** [run 38116854116](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38116854116), fresh dispatch number 51, attempt 1. Apple returned validation success at **06:11:52 UTC** and upload success at **06:13:14 UTC**, both without errors. The signed app/extension inspection and temporary credential cleanup passed. Marketing metadata and the protected environment agree on 1.23.0.

Processing, tester availability, and physical iPhone results were not independently verified after upload. Install through TestFlight when processing and the existing tester assignment permit it, then check **Settings → Profile & preferences → App layout → Tab bar**. Cancel and confirm hiding tabs, restore and reorder them, restart the app, verify Settings remains accessible, and confirm wages and active shifts remain unchanged. See the [physical-device checklist](ios-testflight-delivery.md#physical-device-release-checklist).

This upload does not submit App Review or publish a public App Store update. The beta includes the preceding approved branding, Settings/About, and update-reminder changes.

## Verification

- Frontend Vitest: **861 tests in 109 files**, plus **3 Universal Link generator tests**.
- Backend Vitest: **294 tests in 31 files**. The signed workflow passed **1,158 tests** in its full automated gate, plus the separate **8 distribution-entitlement tests**.
- Production-browser smoke: **15 scenarios**, including unchanged displayed wages and zero account-data writes during hiding/restoration.
- Final targeted layout/navigation/impact verification: **13 tests** passed after the focus-return adjustment.
- Normal and iOS production web builds, TypeScript checks, TestFlight configuration verification, and whitespace checks passed.
- [Frontend/backend PR CI](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38116441418) passed. [iOS Simulator CI](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38116441342) built/inspected the app and verified **40 Live Activity layouts**.
- CodeQL JavaScript/TypeScript and Actions passed; the Swift analysis result is tracked in [run 38116441352](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38116441352).
- Browser previews covered 390×844 dark/light, 320×568, 430×932, 844×390 landscape, 768×1024 tablet, and 1440×1000 desktop. Screenshots use simulated account data.

## Dependency maintenance

The dated dependency advisory queue documented in the README remains separate from this feature. This release does not upgrade dependencies or claim those advisories are resolved; complete that maintenance and device regression before a public App Store release.

**Full changelog:** [v1.22.0 → v1.23.0](https://github.com/Ezaz-Ahmad/WagesTracker/compare/v1.22.0...v1.23.0).
