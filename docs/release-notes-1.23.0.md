# Wages Tracker 1.23.0

Optional tab visibility, prepared **11 October 2026**.

## Changes

- Hide or restore Home, Entry, Spending, Report, and History under **Settings → Profile & preferences → App layout → Tab bar**, alongside the existing ordering controls.
- Review a concise confirmation before hiding each tab. It explains which tools leave the menu, preserves saved records, and states that wage calculations continue unchanged.
- Keep Settings available for recovery. Hidden tabs disappear from mobile menus, desktop navigation, and swipes; launch and cross-window changes choose an available screen.
- Warn when hiding the remaining in-app shift controls, including how to restore them. An active shift continues running.
- Hide the Home spending snapshot together with Spending, then restore the previous widget preference when the tab returns.
- Save preferences per account on the device, preserving older saved layouts. Reset restores every tab and its default order.
- Match existing dark/light styling, keyboard focus, reduced motion, touch targets, and responsive layouts.

See [tab visibility behavior](tab-visibility.md) for the full impact and recovery details. No backend schema, wage calculation, native plugin, or dependency change is included.

## Verification before delivery

- Frontend Vitest: **861 tests in 109 files**, plus **3 Universal Link generator tests**.
- Production-browser smoke: **15 scenarios**, including unchanged displayed wages and zero account-data writes during hiding/restoration.
- Final targeted layout/navigation/impact verification: **13 tests** passed after the focus-return adjustment.
- Normal and iOS production web builds, TypeScript checks, TestFlight configuration verification, and whitespace checks passed.
- Browser previews covered 390×844 dark/light, 320×568, 430×932, 844×390 landscape, 768×1024 tablet, and 1440×1000 desktop. Screenshots use simulated account data.

GitHub CI, the protected-main merge, and signed TestFlight delivery are pending for this source. Delivery evidence will be recorded after completion. Apple processing, tester availability, and physical-device checks are separate from upload acceptance. This beta delivery does not submit App Review or publish a public App Store update.
