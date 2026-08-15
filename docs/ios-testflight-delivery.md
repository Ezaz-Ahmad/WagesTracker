# Signed TestFlight delivery

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
| `IOS_APP_VERSION` | `1.16.0` |
| `APPLE_TEAM_ID` | The 10-character Team ID shown in Apple Developer membership details and the App Store profile |
| `IOS_PROVISIONING_PROFILE_NAME` | `WagesTracker App Store 1.16.0` |

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

After this workflow has been reviewed and merged:

1. Open **Actions → iOS TestFlight Delivery → Run workflow**.
2. Select `main`. The job-level guard skips any other ref even if GitHub displays it in the workflow selector.
3. Approve the `testflight` environment deployment if an approval rule is configured.
4. Review the run through validation, archive, export and App Store Connect validation.
5. Confirm the upload is processing in App Store Connect → WagesTracker → TestFlight. Processing can continue after the workflow reports that Apple accepted the upload.

Do not trigger the signed workflow from this feature branch. Pull-request validation remains the existing unsigned Simulator, CI and three-language CodeQL workflows, with no signing secrets.

## Build numbers

`CFBundleShortVersionString` remains `1.16.0`. Each workflow attempt derives `CFBundleVersion` as `<github.run_number>.<github.run_attempt>`. Run numbers increase for new dispatches; the attempt suffix increases for reruns of the same dispatch. This makes every possible upload identifier unique and monotonically ordered without committing build-number churn to the Xcode project.

## Signing, validation and cleanup

Before signing, the workflow runs all backend/frontend tests, type-checks and production builds, then verifies Capacitor alignment, deterministic assets, the privacy manifest, the exact production iOS build, Capacitor sync and the single-runtime invariant.

Signing material exists only on the ephemeral macOS runner. The workflow creates a temporary keychain, imports the Apple Distribution identity, validates and installs the named App Store profile, exports an App Store Connect IPA, inspects the extracted application, then asks App Store Connect to validate it before upload. The signed IPA is never published as a GitHub artifact.

The extracted application must prove the expected bundle ID, team, distribution identity, App Store profile, TestFlight entitlement, marketing/build versions, iPhone-only family, iOS 15 minimum, production API, runtime count and release-only content. It rejects localhost/live-reload configuration, admin/debug bundles, broad ATS exceptions, certificate-validation bypass markers, protected-resource permissions and development source files.

An `always()` cleanup step deletes the temporary keychain, `.p12`, API key, decoded and installed provisioning profiles, archive, exported IPA and extracted application even when validation or upload fails.

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

- **Validation or signing failure:** do not weaken a check. Correct the environment variable, replace the affected environment secret or regenerate the Apple profile/certificate, then rerun the original workflow. The attempt suffix produces a fresh build number.
- **Apple rejects a duplicate or processed build:** start a new workflow dispatch or rerun the failed attempt; never rewrite the committed marketing version or a Git tag to reuse a build number.
- **Credential exposure or suspected compromise:** revoke the API key/certificate/profile in Apple portals, create replacements, update the GitHub environment secrets and rerun. Removing a secret from GitHub is not sufficient if the original credential may have escaped.
- **Upload accepted but processing fails:** inspect App Store Connect's build processing message. Fix the underlying signing/metadata issue in a reviewed branch; do not submit the failed build to review.
- **Accidental workflow selection on a non-main ref:** the job is skipped before the environment is entered. Re-run from protected `main`.
