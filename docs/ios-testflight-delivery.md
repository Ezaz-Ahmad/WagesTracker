# Signed TestFlight delivery

**Current source marketing version:** `1.27.0`

**Last reviewed:** 22 November 2026

**Backend rollout verification:** `GET /api/health` retains `{ "ok": true }` and, on Render, returns `X-App-Revision` from the validated public `RENDER_GIT_COMMIT`. Check this header against the merged release revision before marking new API behavior delivered; the provider's GitHub deployment status can remain pending after rollout. The response is not cached. See [Render's environment-variable reference](https://render.com/docs/environment-variables#render_git_commit).

**SDK requirement:** Apple's ITMS-90725 email for build 55 identified the iOS 26.5 SDK. Simulator and signed delivery use the `xcode-27` runner with `DEVELOPER_DIR=/Applications/Xcode_27.2.app/Contents/Developer`, verify the selected stable toolchain and iOS SDK before building, and inspect `DTSDKName` in the compiled app and extension with `inspect-ios-build-sdk.mjs`. Artifacts built with an iOS SDK below 27 are rejected before upload. This addresses [Apple's April 2027 SDK requirement](https://developer.apple.com/news/?id=k1mtkt1k); the project retains its existing iOS deployment target. Build/upload receipts for this release are recorded in the release pull request and workflow runs.

**Swift analysis compatibility:** [GitHub documents that traced CodeQL analysis is unsupported on macOS/Xcode 27](https://codeql.github.com/docs/codeql-overview/system-requirements/). The separate Swift security job therefore uses macOS 26 and Xcode 26.6 to analyze the same native source. It has no signing/upload credentials. Its analysis-only artifact inspection retains all runtime/privacy checks; the minimum distribution SDK is enforced independently and unconditionally in the Xcode 27.2 Simulator and signed delivery jobs. No signed build can fall back to the analysis toolchain.

**iOS 27 launch lifecycle:** UIKit requires scene-based launch for apps built with the new SDK. Capacitor is aligned on stable 8.6.2 in npm, Swift Package Manager and the CLI. AppDelegate selects the single SceneDelegate, which creates one UIWindow and the existing plugin-registering MainViewController. It accepts only the application scene role; external displays do not create duplicate bridges. Storyboard window ownership is removed to avoid duplicate initialization. Capacitor's SceneDelegateProxy forwards cold/warm URLs and Universal Links, deferring cold links until plugins are registered. Notification registration and background URL sessions remain process-wide. See [Capacitor's scene migration guide](https://capacitorjs.com/docs/updating/8-5) and [Apple's migration guide](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle).

Simulator QA renders 40 widget layouts, launches the real app on a standard iPhone, rejects nearly empty app screenshots and checks resume without a process restart. It captures a harmless custom-URL request separately; Apple's Open confirmation requires user interaction, so that capture does not assert callback delivery past the prompt. Screenshots, launch output and a visual-readiness receipt are uploaded for review. The compiled app/widget SDKs and single-scene configuration are validated before signed upload.

**1.24.0 delivery status:** Web and API changes are deployed. Apple access was restored after the Account Holder accepted the pending agreement. Fresh build 55 passed the exact app-identity preflight, signed archive, export and distribution checks, Apple validation and upload. The owner confirmed **1.24.0 (55) is available in TestFlight on the iPhone**. Physical-device feature testing remains to be completed.

**Verified upload for 1.24.0:** **1.24.0 (55)**, accepted by Apple on 21 November 2026 in [run 44909308794](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44909308794), from protected-main commit `b792474a9f04bb6914f154df2e1beeca12470e7a`. The Apple validation step completed at **13:42:57 UTC**, and the upload step at **13:44:05 UTC**, both successfully. The fresh dispatch used attempt 1.

**Processing and testers:** The owner confirmed build 55 is available in TestFlight. The signed delivery's final check initially returned HTTP 403 after upload; read-only [recovery run 44911204916](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44911204916) then confirmed processing `VALID`, state `IN_BETA_TESTING` and availability to **WagesTracker Internal Testers**. Both runs cleaned temporary credentials. The verifier now recognizes groups with automatic access to all builds without attempting to modify their explicit build relationships. A separate read-only availability check can inspect the existing upload without signing or uploading again.

**Agreement recovery:** Builds 53 and 54 were not uploaded. Build 53 failed Apple's implicit app lookup (error 19); [build 54](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44908505568) identified the actual account blocker through the API: HTTP `403`, `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`. Both removed temporary signing material. The Account Holder accepted the pending agreement before build 55 was dispatched. If this recurs, review the pending agreement at [Apple Developer Account](https://developer.apple.com/account/); Apple documents that [pending agreements suspend API and TestFlight access](https://developer.apple.com/help/account/access/resolving-access-issues/). After acceptance, use a fresh dispatch, never rerun an older signed delivery.

**Previous verified upload:** **1.23.1 (52)**, accepted by Apple on 11 October 2026 in [run 38121118588](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38121118588), from protected-main commit `d54eb41579a4b76fd56335e43b829444e7a3efa4`. Apple validation succeeded at **07:26:32 UTC** and upload at **07:28:02 UTC**, both without errors. Processing and assignment to **WagesTracker Internal Testers** were confirmed at that time.

**Previous App Review record (11 October 2026):** **1.23.1 (52), Waiting for Review**, submitted **11 October 2026 at 07:37 UTC / 18:37 AEDT**. Submission ID: `e08bed98-479f-4cff-befc-11c5c3af39c6`. Release was configured as automatic after approval, immediately to all users. The public Australian listing was still **1.21.0** when that submission was verified. This historical status has not been rechecked while Apple access is blocked. No public App Store submission was made for 1.24.0. See the [App Review guide](app-store-review.md).

**Earlier upload:** 1.23.0 (51), accepted in [run 38116854116](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38116854116) from `98d376a0609a1471035cab88ea73c88542ec3acf`. It contains the previous native framework; build 52 replaced it for the October review. The preceding 1.22.0 (50) is recorded in [its release notes](release-notes-1.22.0.md).

Wages Tracker's signed iOS delivery is intentionally separate from pull-request, push, Simulator and CodeQL workflows. `.github/workflows/ios-testflight.yml` can be started only with `workflow_dispatch`; its delivery job additionally refuses every ref except protected `main`, rejects fork context, uses the protected `testflight` environment and serializes uploads through one non-cancelling concurrency group.

The workflow uploads a build to TestFlight, waits for Apple processing and verifies availability for the existing **WagesTracker Internal Testers** group. For manual groups it adds this exact build if needed; automatic groups already grant access to all builds and are not modified. It does not create testers/groups, change notification preferences, submit App Review, select an App Store version or release publicly. See Apple's [build-to-group API](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-builds) and [automatic internal distribution guidance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).

If upload succeeded but the final availability check failed, run **iOS TestFlight Availability Check** (`ios-testflight-check.yml`) from `main` with the existing build number. It uses only the API credential in the protected environment, performs read-only checks against the exact app/version/iOS build and existing internal group, and cleans the temporary key. It cannot sign, upload, assign groups or release an app. Do not rerun the signed workflow to recover a post-upload check. Apple errors identify the HTTP method and endpoint without query strings, credentials or response details.

## One-time GitHub environment setup

In the GitHub repository, open **Settings → Environments → New environment**, create an environment named exactly `testflight`, then configure:

- **Deployment branches and tags:** selected branches only, with `main` as the only allowed branch. Do not allow tags or arbitrary branches.
- **Required reviewers:** add a reviewer if the repository has another trusted maintainer. Keep this approval gate enabled for production delivery when practical.
- Do not put signing values in repository variables, Actions workflow inputs, issue comments, pull-request comments or logs.

Create these non-secret environment variables:

| Variable | Value |
| --- | --- |
| `IOS_BUNDLE_ID` | `com.ezazahmad.wagestracker` |
| `IOS_APP_VERSION` | `1.25.0` (required for this release; update the protected environment before dispatch) |
| `APPLE_TEAM_ID` | The 10-character Team ID shown in Apple Developer membership details and the App Store profile |
| `IOS_PROVISIONING_PROFILE_NAME` | The exact `Name` inside the uploaded profile. Prefer a release-independent name such as `WagesTracker App Store Distribution` when next regenerating it |
| `IOS_EXTENSION_PROVISIONING_PROFILE_NAME` | The exact `Name` inside the App Store profile for `com.ezazahmad.wagestracker.ShiftActivityExtension` |

Create these encrypted environment secrets:

| Secret | Secure source |
| --- | --- |
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect issuer ID |
| `ASC_API_KEY_P8_BASE64` | Base64 of the private `AuthKey_*.p8` file |
| `IOS_DISTRIBUTION_P12_BASE64` | Base64 of the password-protected Apple Distribution `.p12` |
| `IOS_DISTRIBUTION_P12_PASSWORD` | Password used when the `.p12` was exported |
| `IOS_APP_STORE_PROFILE_BASE64` | Base64 of the App Store `.mobileprovision` file |
| `IOS_EXTENSION_APP_STORE_PROFILE_BASE64` | Base64 of the App Store `.mobileprovision` file for the embedded Shift Activity extension |

Encode each credential file locally and paste only the resulting Base64 text into its GitHub environment secret. For example, in PowerShell, run this locally with the real path and copy the returned string directly into GitHub:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\private\credential-file'))
```

Never paste the encoded or decoded value into chat, email, Git, workflow inputs or an issue. Keep the original files in private protected storage. GitHub environment secrets are not available to ordinary push, pull-request or fork workflows; the TestFlight job references them only after its protected-main and environment gates are satisfied.

## Manual delivery

Do not dispatch this workflow until the release branch is reviewed, all pull-request checks are green, the exact commit is merged to protected `main`, the live Vercel association file contains the literal Team ID, and the real recovery-email preflight has succeeded.

After those gates pass:

1. Open **Actions → iOS TestFlight Delivery → Run workflow**.
2. Select `main`. The job-level guard skips any other ref even if GitHub displays it in the workflow selector.
3. Approve the `testflight` environment deployment if an approval rule is configured.
4. Review the run through validation, archive, export and App Store Connect validation.
5. Record the workflow URL, protected-main commit, printed marketing/build pair, and App Store Connect processing result.
6. Wait for the final processing/availability step. It checks the exact marketing version, build number and iOS platform, and refuses external or ambiguous groups.
7. Install the ready build on the physical test iPhone from the existing internal group. If Apple processing takes more than 20 minutes, the run fails with an explicit pending-processing message; do not upload the same binary again. Inspect that build in App Store Connect.
8. Complete the device and password-recovery checklist below before treating it as a release candidate.

Do not trigger the signed workflow from this feature branch. Pull-request validation remains the existing unsigned Simulator, CI and three-language CodeQL workflows, with no signing secrets.

## Build numbers

`CFBundleShortVersionString` is `1.25.0` for this release. `frontend/package.json` is the source of truth; the lockfile, Xcode project and GitHub `IOS_APP_VERSION` variable must match, and the validation script/workflow fail if they do not. Each new workflow dispatch derives `CFBundleVersion` directly from `github.run_number`, which increases across new runs without committing build-number churn to the Xcode project. The workflow accepts only `github.run_attempt == 1`; GitHub reruns keep the original run number and could therefore break reliable ordering after a newer dispatch. If a run fails, fix the cause and start a new **Run workflow** dispatch instead of using **Re-run jobs**.

## Signing, validation and cleanup

Before signing, the workflow runs all backend/frontend tests, type-checks and production builds, then verifies Capacitor alignment, deterministic assets, the privacy manifest, the exact production iOS build, Capacitor sync and the single-runtime invariant.

After installing temporary credentials, a read-only App Store Connect API preflight verifies that bundle ID `com.ezazahmad.wagestracker` resolves to the existing Apple app ID `6801702467`. Both altool validation and upload receive this verified ID explicitly through `--apple-id`, avoiding the implicit bundle-ID lookup that failed with error 19 in Xcode 26.6 in [build 53](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44907303329). That run stopped before upload. API failures report only HTTP status and bounded Apple error codes; an agreement error still requires the Account Holder to review Apple's terms in App Store Connect.

Signing material exists only on the ephemeral macOS runner. The workflow creates a temporary keychain, imports the Apple Distribution identity, validates and installs the named application and Shift Activity extension App Store profiles, exports an App Store Connect IPA, inspects the extracted application and embedded extension, then asks App Store Connect to validate it before upload. The signed IPA is never published as a GitHub artifact.

The extracted application must prove the expected bundle ID, team, distribution identity, App Store profile, TestFlight entitlement, `applinks:wages-tracker-frontend.vercel.app` Associated Domains entitlement, marketing/build versions, iPhone-only family, iOS 15 minimum, production API, runtime count and release-only content. It rejects localhost/live-reload configuration, admin/debug bundles, broad ATS exceptions, certificate-validation bypass markers, protected-resource permissions and development source files. Apple can serialize the Associated Domains authorization in a provisioning profile as the wildcard string `*`; the workflow accepts that profile-level form, while the signed application is still required to contain the concrete production domain. This entitlement inspection prevents the exact archive failure caused by using a profile generated before Associated Domains was enabled.

An `always()` cleanup step deletes the temporary keychain, `.p12`, API key, decoded and installed provisioning profiles, archive, exported IPA and extracted application even when validation or upload fails.

## Universal Link preflight

1. In Vercel → Wages Tracker frontend → Settings → Environment Variables, set `APPLE_TEAM_ID` to the literal 10-character team id for **Production** (and Preview if links must be tested there). It is public metadata, not a secret.
2. Redeploy the frontend from the intended commit. Production deployment now fails closed if `APPLE_TEAM_ID` is absent, so a placeholder file cannot be published silently again.
3. Open `https://wages-tracker-frontend.vercel.app/.well-known/apple-app-site-association`. Require HTTP 200, `Content-Type: application/json`, the literal `<TEAM_ID>.com.ezazahmad.wagestracker`, and no `$(` placeholder.
4. In Apple Developer → Certificates, Identifiers & Profiles → Identifiers → `com.ezazahmad.wagestracker`, confirm **Associated Domains** is enabled.
5. Regenerate/download the App Store distribution profile after that capability change. Replace `IOS_APP_STORE_PROFILE_BASE64` with the Base64 of this new file and make `IOS_PROVISIONING_PROFILE_NAME` match its internal Name exactly.
6. After installing the processed TestFlight build, request a new reset email and tap its link in Apple Mail. It must open WagesTracker directly on the reset screen. Long-press the link to confirm the expected HTTPS host. Safari fallback remains functional but does not satisfy the native release gate.

## Physical-device release checklist

- Cold launch, warm launch, background/resume, offline launch, and recovery after a Render cold start.
- Portrait and landscape where supported; small/tall iPhone safe areas; keyboard focus/close; no clipped CTA, fields, modal actions or bottom navigation.
- Signup, normal login, logout, authenticated password change, session list/revoke, account deletion confirmation and biometric enable/cancel/success/soft-lock/retry.
- With a real registered mailbox: request reset, receive email, open it as a Universal Link, set a policy-valid new password, reject token reuse, reject old password, prove previous sessions are revoked, sign in with the new password, and re-enable/verify biometric login.
- Home, Entry, Spending (all tabs and dialogs), Report PDF share sheet, History edits/PDF, Settings and public pages with realistic long and large values.
- App layout → Tab bar: cancel and confirm hiding each optional tab, restore it, reorder visible tabs, and reload the app. Verify Settings remains accessible with every optional tab hidden. Confirm hiding Spending hides its Home snapshot, wage totals remain unchanged, and the last-clock-control warning explains recovery without ending an active shift.
- Start a shift and verify the Live Activity in light/dark mode, Lock Screen, notification area and Dynamic Island where supported; confirm elapsed time remains accurate in the background and after removing the app from recent apps.
- Clock out from the Live Activity after native confirmation; verify repeat taps are idempotent, offline clock-out retains its first finish time and retries, failures preserve the active shift, completion shows the final duration, and dashboard/fuel/wage totals refresh.
- Deny ordinary notification permission and disable Live Activities separately; neither setting may prevent Start Shift. Re-enable and verify restoration on app launch. Record the documented eight-hour/boot-restoration ActivityKit boundaries from [`active-shift-live-activity.md`](active-shift-live-activity.md).
- No repeatable white screen, console/device log error, unhandled request failure, overlapping content or silent action failure.

Record the exact build number and result of each item. A simulator or responsive browser is useful but cannot replace this checklist.

## Export-compliance audit

The iOS application uses encryption supplied by Apple platforms:

- HTTPS is performed by the WebKit/Apple networking stack against the pinned production API.
- remembered authentication tokens are stored through the iOS Keychain, via the secure-storage plugin and KeychainSwift/Security APIs.
- the iOS client does not bundle the backend's Argon2/password hashing implementation, implement proprietary encryption, provide a VPN, or provide user-selectable cryptographic functionality.
- Capacitor App, Filesystem, Network and Share provide lifecycle, temporary-file, reachability and share-sheet functions; the client-side PDF generator does not encrypt reports.

Based on the audited code and dependencies, `ITSAppUsesNonExemptEncryption` is `NO`: the app uses no non-exempt encryption. Apple documents that OS-provided encryption such as system HTTPS is typically exempt from documentation, and that `NO` is appropriate when the app and linked libraries use no encryption or only exempt encryption. The declaration must be re-audited whenever a native SDK, secure-storage implementation, networking layer or cryptographic feature changes. The Account Holder remains responsible for the legal export classification and any required annual self-classification or country-specific filing.

Apple references:

- [Complying with Encryption Export Regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)
- [ITSAppUsesNonExemptEncryption](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption)
- [Export compliance documentation for encryption](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption/)

## Recovery procedure

- **Validation or signing failure:** do not weaken a check. Correct the environment variable, replace the affected environment secret or regenerate the Apple profile/certificate, then start a new workflow dispatch. Never use **Re-run jobs** for signed delivery.
- **Apple rejects a duplicate or processed build:** start a new workflow dispatch; never rerun an older attempt, rewrite the committed marketing version or move a Git tag to reuse a build number.
- **Credential exposure or suspected compromise:** revoke the API key/certificate/profile in Apple portals, create replacements, update the GitHub environment secrets and start a new workflow dispatch. Removing a secret from GitHub is not sufficient if the original credential may have escaped.
- **Upload accepted but processing fails:** inspect App Store Connect's build processing message. Fix the underlying signing/metadata issue in a reviewed branch; do not submit the failed build to review.
- **Accidental workflow selection on a non-main ref:** the job is skipped before the environment is entered. Start a new workflow dispatch from protected `main`.
- **Bad web/backend deployment:** use the hosting provider's rollback/redeploy control to restore the last known-good commit, verify `/api/health` and the AASA file, then fix forward through a reviewed branch. Do not roll back the Turso database file independently of the API schema.
- **Bad TestFlight build:** stop assigning it to testers, remove it from the tester group where possible, and upload a corrected build with a fresh workflow dispatch/build number. TestFlight binaries are immutable; do not move a tag or attempt to replace an accepted build.
- **Password-recovery incident:** disable or rotate the Resend key on Render if mail credentials are involved, inspect provider delivery logs without exposing reset URLs, and deploy the fix. Existing recovery links can be invalidated per account by issuing a newer link or changing the password; a system-wide secret rotation invalidates all HMAC-derived links but also requires careful JWT/session planning.
