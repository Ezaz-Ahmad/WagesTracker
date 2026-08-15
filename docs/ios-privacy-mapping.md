# iOS privacy manifest and App Store mapping

This document is the review record for `ios/App/App/PrivacyInfo.xcprivacy` and the future App Store Connect privacy questionnaire. It must be re-audited whenever a native plugin, SDK, backend data field, analytics tool or advertising feature is added.

## Data collection

All declared data is linked to the signed-in Wage Tracker account, used only for app functionality, and not used for tracking or advertising.

| Apple category | Wage Tracker data | Purpose and processing |
| --- | --- | --- |
| Name | Account name | Account display and named PDF reports; API/Render and Turso |
| Email address | Sign-in email | Authentication and account support; API/Render and Turso |
| Physical address | Home and work addresses | Shared commute/work profile features; API/Render and Turso |
| Other financial information | Pay rate, goals, shifts, expenses and other earnings | Wage calculations, history and reports; API/Render and Turso |
| User ID | Internal account and session identifiers | Authentication, isolation and session security; API/Render and Turso |
| Device ID | Random installation identifier | Session rotation and device management; API/Render and Turso |

Vercel serves the web build and processes ordinary request metadata. Render hosts the API and processes request/authentication metadata and operational logs. Turso stores the account, work and session records listed above. Weekly PDF bytes are created on-device and are not uploaded as files. On iOS, the user explicitly chooses destinations through Apple’s standard share sheet.

## Required-reason APIs

`@capacitor/filesystem` writes a generated PDF into the application’s cache before sharing it and removes the temporary file afterward. Its file metadata/timestamp access is declared as `NSPrivacyAccessedAPICategoryFileTimestamp` with Apple-approved reason `C617.1`, limited to files inside the app container.

## Permissions and capabilities

The current native app requests no Contacts, Photos, Camera, Microphone, Location, Bluetooth or advertising-tracking permission. Filesystem access is app-container Cache access and Share presents a user-initiated system sheet; neither requires adding a protected-resource usage description.

## Review checklist for App Store submission

- Reconcile this table with the live public Privacy Policy.
- Inspect Xcode’s privacy report and every bundled SDK privacy manifest.
- Confirm App Store Connect answers mark the declared categories as linked, App Functionality, and not tracking.
- Re-audit if analytics, crash reporting, support SDKs or new permissions are introduced.
