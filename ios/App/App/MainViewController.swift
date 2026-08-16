import Capacitor
import UIKit

/// The app's bridge view controller — Main.storyboard's single scene points
/// its "Bridge View Controller" at this class (customClass = "MainViewController",
/// customModule = "App") instead of the framework's own `CAPBridgeViewController`
/// directly, which is what Capacitor's own docs describe as the supported way
/// to register app-local native code
/// (https://capacitorjs.com/docs/ios/custom-code,
/// https://capacitorjs.com/docs/ios/viewcontroller).
///
/// `BiometricAuthPlugin` conforming to `CAPBridgedPlugin` (see that file)
/// only makes the class discoverable to the bridge's reflection — it does
/// not, by itself, put an instance of it in the bridge's plugin registry.
/// That registration is this file's entire job: `capacitorDidLoad()` is
/// called once the bridge has finished setting itself up, and
/// `registerPluginInstance` is the only supported way to hand it a plugin
/// that lives directly in the app target rather than being pulled in as a
/// Cocoapod/SPM package with its own `Package.swift`/`podspec` manifest.
///
/// If this file, or the storyboard's customClass pointing to it, is ever
/// removed, `BiometricAuthPlugin` still compiles and still passes every
/// Capacitor-version-alignment check in this repo — but at runtime
/// `Capacitor.registerPlugin("BiometricAuth")` on the JS side rejects every
/// call with "BiometricAuth does not have an implementation". See
/// `frontend/scripts/verify-ios-plugin-registration.mjs`, which exists
/// specifically to catch that class of regression in CI without needing a
/// macOS runner.
class MainViewController: CAPBridgeViewController {
  override open func capacitorDidLoad() {
    bridge?.registerPluginInstance(BiometricAuthPlugin())
    // See ShiftNotificationPlugin.swift — this registration only makes
    // `postShiftStarted`/`clearShiftNotification`/etc. callable from JS
    // while the app is actually running; the notification category and the
    // `UNUserNotificationCenterDelegate` a background "Sign out" tap needs
    // are wired up separately and earlier, in AppDelegate, since this
    // method may never run at all in a background-only notification-
    // response launch.
    bridge?.registerPluginInstance(ShiftNotificationPlugin())
  }
}
