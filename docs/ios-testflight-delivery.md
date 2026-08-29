# Signed TestFlight delivery

**Current source marketing version:** `1.19.0`

**Last reviewed:** 29 August 2026

WagesTracker's signed iOS delivery is intentionally separate from pull-request, push, Simulator and CodeQL workflows. `.github/workflows/ios-testflight.yml` can be started only with `workflow_dispatch`; its delivery job additionally refuses every ref except protected `main`, rejects fork context, uses the protected `testflight` environment and serializes uploads through one non-cancelling concurrency group.

The workflow uploads a build to TestFlight only. It does not assign testers, submit the app to App Review, select a build for the App Store version or release the application publicly.

## One-time GitHub environment setup

In the GitHub repository, open **Settings → Environments → New environment**, create an environment named exactly `testflight`, then configure:

- **Deployment branches and tags:** selected branches only, with `main` as the only allowed branch. Do not allow tags or arbitrary branches.
- **Required reviewers:** add a reviewer if the repository has another trusted maintainer. Keep this approval gate enabled for production delivery when practical.
- Do not put signing values in repository variables, Actions workflow inputs, issue comments, pull-request comments or logs.

Create these non-secret environment variables:

| Variable | Value |
| --- | --- |
| `IOS_BUNDLE_ID` | `com.ezazahmad.wagestracker` |
| `IOS_APP_VERSION` | `1.19.0` (must match `frontend/package.json`) |
| `APPLE_TEAM_ID` | The 10-character Team ID shown in Apple Developer membership details and the App Store profile |
| `IOS_PROVISIONING_PROFILE_NAME` | The exact `Name` inside the uploaded profile. Prefer a release-independent name such as `WagesTracker App Store Distribution` when next regenerating it |

Create these encrypted environment secrets:

| Secret | Secure source |
| --- | --- |
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect issuer ID |
| `ASC_API_KEY_P8_BASE64` | Base64 of the private `AuthKey_*.p8` file |
| `IOS_DISTRIBUTION_P12_BASE64` | Base64 of the password-protected Apple Distribution `.p12` |
| `IOS_DISTRIBUTION_P12_PASSWORD` | Password used when the `.p12` was exported |
| `IOS_APP_STORE_PROFILE_BASE64` | Base64 of the App Store `.mobileprovision` file |

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
6. Confirm the upload is processing in App Store Connect → WagesTracker → TestFlight. Processing can continue after the workflow reports that Apple accepted the upload.
7. Assign the processed build to the intended internal tester group and install it on the physical test iPhone.
8. Complete the device and password-recovery checklist below before treating it as a release candidate.

Do not trigger the signed workflow from this feature branch. Pull-request validation remains the existing unsigned Simulator, CI and three-language CodeQL workflows, with no signing secrets.

## Build numbers

`CFBundleShortVersionString` is `1.19.0` for this release. `frontend/package.json` is the source of truth; the lockfile, Xcode project and GitHub `IOS_APP_VERSION` variable must match, and the validation script/workflow fail if they do not. Each new workflow dispatch derives `CFBundleVersion` directly from `github.run_number`, which increases across new runs without committing build-number churn to the Xcode project. The workflow accepts only `github.run_attempt == 1`; GitHub reruns keep the original run number and could therefore break reliable ordering after a newer dispatch. If a run fails, fix the cause and start a new **Run workflow** dispatch instead of using **Re-run jobs**.

## Signing, validation and cleanup

Before signing, the workflow runs all backend/frontend tests, type-checks and production builds, then verifies Capacitor alignment, deterministic assets, the privacy manifest, the exact production iOS build, Capacitor sync and the single-runtime invariant.

Signing material exists only on the ephemeral macOS runner. The workflow creates a temporary keychain, imports the Apple Distribution identity, validates and installs the named App Store profile, exports an App Store Connect IPA, inspects the extracted application, then asks App Store Connect to validate it before upload. The signed IPA is never published as a GitHub artifact.

The extracted application must prove the expected bundle ID, team, distribution identity, App Store profile, TestFlight entitlement, `applinks:wages-tracker-frontend.vercel.app` Associated Domains entitlement, marketing/build versions, iPhone-only family, iOS 15 minimum, production API, runtime count and release-only content. It rejects localhost/live-reload configuration, admin/debug bundles, broad ATS exceptions, certificate-validation bypass markers, protected-resource permissions and development source files. Apple can serialize the Associated Domains authorization in a provisioning profile as the wildcard string `*`; the workflow accepts that profile-level form, while the signed application is still required to contain the concrete production domain. This entitlement inspection prevents the exact archive failure caused by using a profile generated before Associated Domains was enabled.

An `always()` cleanup step deletes the temporary keychain, `.p12`, API key, decoded and installed provisioning profiles, archive, exported IPA and extracted application even when validation or upload fails.

## Universal Link preflight

1. In Vercel → Wage Tracker frontend → Settings → Environment Variables, set `APPLE_TEAM_ID` to the literal 10-character team id for **Production** (and Preview if links must be tested there). It is public metadata, not a secret.
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
