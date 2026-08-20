# iOS privacy manifest and App Store mapping

This document is the review record for `ios/App/App/PrivacyInfo.xcprivacy` and the future App Store Connect privacy questionnaire. It must be re-audited whenever a native plugin, SDK, backend data field, analytics tool or advertising feature is added.

## Data collection

All declared data is linked to the signed-in Wage Tracker account, used only for app functionality, and not used for tracking or advertising.

| Apple category | Wage Tracker data | Purpose and processing |
| --- | --- | --- |
| Name | Account name | Account display and named PDF reports; API/Render and Turso |
| Email address | Sign-in email | Authentication and account support; API/Render and Turso |
| Physical address | Home and work addresses | Shared commute/work profile features; API/Render and Turso |
| Other financial information | Pay rate, goals, shifts, work expenses, other earnings, and optional personal spending amounts/categories/dates/merchant titles/notes/payment-method labels | Wage calculations, personal spending history and comparisons, and reports; API/Render and Turso |
| User ID | Internal account and session identifiers | Authentication, isolation and session security; API/Render and Turso |
| Device ID | Random installation identifier | Session rotation and device management; API/Render and Turso |

Vercel serves the web build and processes ordinary request metadata. Render hosts the API and processes request/authentication metadata and operational logs. Turso stores the account, work, optional personal-spending and session records listed above. Weekly wage PDF bytes are created on-device and are not uploaded as files; personal spending is not added to those wage PDFs. On iOS, the user explicitly chooses destinations through Apple’s standard share sheet.

## Personal Spending Tracker review note (20 August 2026)

This feature adds no native SDK, permission, advertising identifier, analytics event, bank connection, receipt/photo access or tracking. It therefore requires no new `NSPrivacyAccessedAPITypes` entry and no change to the committed `PrivacyInfo.xcprivacy` category set: the data remains covered by Apple's existing **Other Financial Info**, linked to the account, used for **App Functionality**, and not used for tracking.

Before the next App Store submission, the Account Holder should update/reconfirm the App Store Connect App Privacy questionnaire's explanatory scope for **Other Financial Info** so it explicitly includes optional personal expense data. This PR deliberately does not change App Store Connect declarations or upload a build.

## Required-reason APIs

`@capacitor/filesystem` writes a generated PDF into the application’s cache before sharing it and removes the temporary file afterward. Its file metadata/timestamp access is declared as `NSPrivacyAccessedAPICategoryFileTimestamp` with Apple-approved reason `C617.1`, limited to files inside the app container.

Biometric authentication (`ios/App/App/BiometricAuthPlugin.swift`, via Apple’s `LocalAuthentication` framework) is not one of Apple’s required-reason API categories and adds no entry to `NSPrivacyAccessedAPITypes`. `LAContext` never exposes raw biometric data to the app or this manifest — it returns only a success/failure signal from the Secure Enclave — so nothing here changes because of it.

## Permissions and capabilities

The current native app requests no Contacts, Photos, Camera, Microphone, Location, Bluetooth or advertising-tracking permission. Filesystem access is app-container Cache access and Share presents a user-initiated system sheet; neither requires adding a protected-resource usage description.

Face ID requires `NSFaceIDUsageDescription` (Touch ID needs no Info.plist declaration): `ios/App/App/Info.plist` declares "Use Face ID to securely unlock WagesTracker." The app never receives the face/fingerprint data itself — only the OS-level authentication result — and never bundles that description text or any biometric state into analytics or logs. See "Biometric login (Face ID / Touch ID)" below for what is and is not stored as a result of a successful prompt.

## Biometric login (Face ID / Touch ID)

Biometric login is an optional, user-initiated alternative to typing a password on this device; it never replaces backend session validation (see the main README's "Biometric login" section for the full security model). Two Keychain items back it, both scoped to this app only (no iCloud Keychain sync):

| Item | Contents | Access control |
| --- | --- | --- |
| Metadata | Account id, display name, detected biometry kind — no secret | Ordinary Keychain (`whenUnlockedThisDeviceOnly`), not biometric-gated, so Settings/the login screen can read it without a Face ID/Touch ID prompt |
| Credential | The session bearer token (JWT) | `SecAccessControl` with `.biometryCurrentSet`, requiring a live Face ID/Touch ID match against the device's *current* enrollment on every read |

Nothing here is collected by, or leaves to, Vercel/Render/Turso — both items exist only in this device's Keychain. Re-enrolling or changing the device's Face ID/Touch ID invalidates the credential item at the OS level; the app detects that on the next attempt and clears both items rather than leaving a broken credential behind. Logging out, changing the password, revoking the current session, or deleting the account also clears both items immediately (see AppContext in the main README).

## Review checklist for App Store submission

- Reconcile this table with the live public Privacy Policy.
- Inspect Xcode’s privacy report and every bundled SDK privacy manifest.
- Confirm App Store Connect answers mark the declared categories as linked, App Functionality, and not tracking.
- Re-audit if analytics, crash reporting, support SDKs or new permissions are introduced.
- Confirm `NSFaceIDUsageDescription` is present and accurate, and that Face ID/Touch ID is answered as App Functionality, not tracking, in the App Privacy questionnaire.
