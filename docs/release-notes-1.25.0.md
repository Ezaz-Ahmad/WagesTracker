# Wages Tracker 1.25.0

Permanently delete a job from Settings → Your jobs. Review the affected shifts, locations, pay records, allowances, extras and linked spending, then enter the job name to confirm. Earnings and future reports update after deletion. Other jobs and unlinked spending remain. End a running shift first. Deleting the last job offers a fresh add-job screen without recreating old records.

All jobs on Home now focuses on work earnings and goals. Settings uses Your jobs to choose the employer to edit; the workspace picker remains on the other tabs. Privacy and Support have clearer navigation, readable sections, expandable help topics and a persistent Return to Wages Tracker control, including on small iPhones.

Native builds select stable Xcode 27.2 and verify the actual compiled app and widget SDK is iOS 27 or newer before upload. This resolves the obsolete-SDK warning reported for build 55 while retaining the existing iOS deployment target.

The iOS app adopts the required scene lifecycle using Capacitor 8.6.2 and one explicitly owned window, preserving the existing plugin-registering bridge, notification handling, background clock-out sessions and account links. Simulator validation checks rendered app screens and launch/resume behavior alongside the widget previews. Swift security analysis runs separately with its supported toolchain.

The release pull request and signed workflow record the uploaded version, build number, SDK inspection and TestFlight processing result. TestFlight delivery does not submit a public App Store release.
