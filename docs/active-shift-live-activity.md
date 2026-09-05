# Active-shift native surface

**Implemented platform:** iOS native application

**Last reviewed:** 5 September 2026

When the user enables **Settings → Profile & preferences → Active shift
notification**, WagesTracker uses a real ActivityKit Live Activity for an open
shift. The preference is off by default and stored separately for each account
on each installation; enabling it on one iPhone does not turn it on elsewhere.
It does not use a repeating JavaScript timer or a scheduled local-notification loop.
The operating system renders elapsed time from the same absolute start instant
used by the React dashboard, so it continues to advance while the WebView is
suspended, the screen is locked, or the user is in another app.

## Lock Screen and Dynamic Island design

The Lock Screen panel groups the shift status and location with a clear
**End Shift** action, a large elapsed timer, and the start time/date. The date
helps distinguish overnight shifts. The expanded Dynamic Island uses the same
hourly chart and actions; compact presentations retain the elapsed timer.

The hourly chart displays 24 equal columns: each holds one hour of actual
elapsed time, and the current hour fills continuously from the bottom. The
axis is labelled 0–24 hours and the legend explains each bar. It represents
time worked, not earnings, productivity, a scheduled end, or an overtime rule.
It covers the first 24 hours; the exact elapsed timer remains the source of
truth for longer shifts. The previous arbitrary eight-hour rail is removed.

Both the elapsed text and the chart use system-rendered date controls
(`Text(timerInterval:)` and built-in linear `ProgressView(timerInterval:)`).
They do not depend on `TimelineView`, JavaScript, per-second server updates,
or an app that stays awake. iOS controls the actual refresh cadence and Live
Activity lifetime; the chart does not extend the platform limit below.

Confirmation replaces the chart with **Keep working / End Shift** controls.
Saving/retry states show their explanatory message. Light/dark colors adapt
to the app preference, and reduced motion/Always-On mode suppress transition
animation. At larger text sizes, the chart gives way to the essential text;
text scaling is bounded to fit the system's 160-point presentation height.
VoiceOver receives the exact elapsed value, location and start time instead
of reading 24 decorative columns. A completed timer uses the saved duration,
so an offline clock-out's response time cannot inflate it.

On macOS, `node frontend/scripts/render-ios-live-activity.mjs` renders the
actual SwiftUI views at 320, 356 and 408 points in light/dark mode, all five
phases, plus larger accessibility sizes. It fails for layouts over 160 points.
The iOS Simulator workflow uploads those PNGs as `live-activity-previews`.
These are native view previews; physical-device testing must still confirm
Lock Screen timer refreshes, Dynamic Island placement and real intent actions.

## Supported behaviour

| Surface | Behaviour |
| --- | --- |
| iOS 17 or later | Lock Screen, notification-area and Dynamic Island Live Activity with a native **Clock Out** action |
| iOS 16.1–16.x | Live elapsed-time activity; tapping **Open to clock out** returns to WagesTracker because interactive Live Activity buttons require iOS 17 |
| iOS 15 | The shift still starts and works normally, but ActivityKit is unavailable and the app shows a non-blocking explanation |
| Web / installed PWA | Shift behaviour is unchanged; browsers cannot provide the native persistence guarantee |
| Android | Not yet available because this repository does not contain an Android native shell; see [Android integration required](#android-integration-required) |

Starting a shift remains a database-first operation whether the preference is
on or off. When enabled, the API's seven-day signed credential is passed to the
native bridge and limited to clocking out that one shift. The native bridge
stores only that narrow credential in the device-only Keychain;
it never exposes or persists the user's general account token for a Lock Screen
action. On an authenticated app restart, the client finds the authoritative
open shift, asks the API for a fresh scoped credential and de-duplicates or
recreates the Live Activity by shift ID. Turning the preference off immediately
removes the system surface without ending the shift or signing the user out. If
an offline clock-out was already confirmed, its captured finish time and
background upload are preserved.

Clock-out from the app and from the Live Activity use one server operation. A
conditional database update makes it idempotent: the first accepted request
fixes the finish time, and repeat taps or background replays return the already
completed shift without changing it. Fuel allowance, spending aggregates,
hours and wage totals are invalidated and refreshed from that saved row.

The native action requires device authentication and a system confirmation
before capturing the finish time. It then creates an iOS-owned background
upload. The first finish time is persisted locally and reused through offline
retries. A server or validation failure leaves the shift and Live Activity
active, changes the action to **Retry**, and preserves all data. A successful
request ends the activity, emits a short final-duration notification when the
user has allowed alerts, and tells the WebView to refresh immediately when it
is running.

Ordinary notification permission is deliberately separate from Live Activity
authorization. Denying it suppresses only the short completion alert; it never
breaks Start Shift. Live Activities can be disabled separately in iOS Settings,
which also never rolls back a successfully started shift.

## Apple platform boundaries

ActivityKit is the strongest supported iOS equivalent to an Android ongoing
notification, but it is not an unlimited foreground service. Apple documents
that a Live Activity can remain active for a maximum of eight hours and may
remain on the Lock Screen for up to four more hours after it ends. WagesTracker
therefore cannot truthfully guarantee an uninterrupted system surface for a
shift longer than that limit. The shift and dashboard timer remain correct in
the database/app.

iOS also does not provide third-party apps with a boot receiver. An activity
that iOS preserves remains system-owned; if the system discards it during a
restart, WagesTracker restores it on the next authenticated app launch. A
guarantee that it reappears without the user opening the app would require a
separate ActivityKit push-to-start design: APNs entitlement and keys, per-device
push-to-start token registration, a secure backend token store, server-side
activity lifecycle tracking, and remote start/update delivery. That
infrastructure is intentionally not simulated with a fragile local workaround.

Apple references: [Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [Adding interactivity to widgets and Live Activities](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities), and [App Intent confirmation](https://developer.apple.com/documentation/appintents/appintent/requestconfirmation%28%29).

## TestFlight signing setup

The new `ShiftActivityExtension` is a separately signed embedded target with
bundle identifier `com.ezazahmad.wagestracker.ShiftActivityExtension`.
Before the next signed build:

1. Register that explicit identifier in Apple Developer and create an App Store
   distribution provisioning profile for it.
2. In GitHub's protected `testflight` environment, set
   `IOS_EXTENSION_PROVISIONING_PROFILE_NAME` to the profile's exact internal
   name.
3. Store the Base64-encoded profile only in the environment secret
   `IOS_EXTENSION_APP_STORE_PROFILE_BASE64`.
4. Keep the existing application profile and secret unchanged. The delivery
   workflow validates, installs, maps and removes both profiles independently.

Run these checks before delivery:

```text
npm run verify:ios-plugin-registration
npm run verify:ios-live-activity
npm run ios:testflight:verify -w frontend
```

The macOS Simulator workflow compiles the extension. Final acceptance still
requires a physical iPhone because Lock Screen persistence, Dynamic Island,
device authentication, offline background upload and notification permission
cannot be proven by jsdom or a responsive browser.

## Android integration required

There is currently no `android/` project in this repository, so a genuinely
persistent Android notification cannot be implemented or validated yet. Do not
replace it with web push or a service-worker timer; either can disappear when
the PWA is closed and neither provides a production clock-out action.

The required native milestone is:

1. Add and commit the Capacitor 8.4.2 Android platform from the existing shared
   frontend contract.
2. Add a Kotlin `ActiveShiftActivity` Capacitor plugin backed by a
   `START_STICKY` foreground service and one low-importance notification
   channel. Use a fixed notification ID, `setOngoing(true)`, an OS chronometer
   based on the shared start instant, and no per-second database writes.
3. Declare the appropriate foreground-service permission/type for the final
   Android target SDK and document that use for Google Play review. Request
   `POST_NOTIFICATIONS` where required, but allow Start Shift to succeed when
   permission is denied.
4. Route **Clock Out** through a small confirmation Activity, then through the
   same scoped-token and idempotent API contract implemented here. Store the
   token in Android Keystore-backed encrypted storage.
5. Persist the captured finish time, use WorkManager for connected-network
   retry, retain the ongoing notification with a **Retry** action on failure,
   and stop the service only after the API confirms success.
6. Add a boot-completed receiver that queries/restores the authoritative open
   shift, plus service/notification de-duplication and instrumentation tests on
   the supported Android API range.

Android foreground-service launch restrictions and declared service types must
be reviewed against the exact target SDK at implementation time. See Google's
[foreground services overview](https://developer.android.com/develop/background-work/services/fgs).

## Physical-device acceptance matrix

Verify the setting is absent on web/PWA, off on a fresh native installation,
account-isolated, and able to start/remove the Live Activity during an existing
shift without changing that shift. Test a normal shift and an offline clock-out on at least one small and one tall
iPhone, in light/dark mode, from an unlocked app, another app, Lock Screen and
after force-removing WagesTracker from recent apps. Also test permission denied,
Live Activities disabled, rapid repeat taps, backend failure/retry, app relaunch,
device restart, an overnight shift, and iOS 16.1/17/current iOS where available.
Verify the first captured finish time, completed duration, dashboard, fuel
allowance and all wage totals against the database after every success path.
