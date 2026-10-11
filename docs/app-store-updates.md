# Wages Tracker name and iOS update prompts

The user-facing product name is **Wages Tracker**. The iPhone home-screen name
(`CFBundleDisplayName`), Capacitor name, PWA title, UI, reports and email copy
use this spelling. The existing bundle ID, App Store ID, URL scheme, storage
keys and repository slug stay stable so this remains an update to the same app.

## Published-release detection

Native iOS reads the installed marketing version from `App.getInfo()`, then
uses Capacitor's native HTTP helper to query Apple's public lookup API for
App Store ID **6801702467**, bundle ID `com.ezazahmad.wagestracker`, in the
Australian storefront. It sends no app account, session, shift or expense data.
The result must match both identities. Numeric version comparison ignores
build numbers and never offers an equal version or a downgrade from TestFlight.

Checks run after startup/authentication settles and when the app returns to
the foreground, with a timer for periodic checks while the app stays visible.
Successful results are cached in memory for six hours;
failed checks are silent and retried after fifteen minutes. Requests have
eight-second connection and read timeouts and concurrent checks are shared.
An existing action dialog takes priority. Privacy, Support and recovery pages
do not show the prompt. Web/PWA uses its existing deployment-refresh flow.

**Update now** opens the fixed official listing at
<https://apps.apple.com/app/id6801702467>. Capacitor iOS sends external
top-level links through `UIApplication.open`; it does not navigate the app's
WebView away from the user's work. **Not now**, Escape and backdrop dismissal
snooze update prompts for 48 hours, persisted locally across launches. A newer
release during that period does not shorten the user's reminder choice. At
the deadline, the visible app checks again; a closed/backgrounded app checks
when next opened or resumed. The prompt returns only if the installed version
is still older than Apple's current public version, and its Installed → Latest
labels use those actual versions. Updating the app ends reminders for that
release; subsequent releases are detected by the same lookup automatically.
All checks are optional: an unavailable App Store cannot block app use.

## First rollout and App Store metadata

Version **1.21.0**, currently public, has no native App Store update checker.
It cannot acquire this popup through a backend change or a TestFlight upload.
Those users need Apple's automatic updates or a manual first update to a
release containing this feature. Later public releases can then trigger the
popup without any hardcoded latest-version change.

Before submitting the next version publicly, set **App Store Connect → WagesTracker →
App Information → Localizable Information → Name** to **Wages Tracker** for
each supported localization. The display name inside the binary does not
rename the App Store listing. Save the name with the next review submission;
do not create a new listing or change the application identity.

TestFlight uploads do not trigger App Store prompts. Apple must approve and
publish a numerically newer version, and its public catalog must reflect it.
The App Store controls whether its listing shows **Update**, **Open**, or a
cloud download button. The app opens the listing and does not install itself.

## Verification

Automated coverage includes numeric version boundaries, identity validation,
equal/newer TestFlight versions, caching/concurrency, offline backoff, persisted
snoozes, focus trapping, accessibility, native URL and dialog priority.
Local previews can simulate a future public listing without changing Apple's
live version. On iPhone, verify that **Update now** opens the existing listing
and that dismissing the prompt leaves the current screen and active shift intact.
