# Wages Tracker 1.23.1

Security patch delivered **11 October 2026**. **1.23.1 (52)** is processed in TestFlight and **Waiting for Review** in App Store Connect. Public App Store approval and publication are pending.

## Changes

- Update Capacitor core, iOS, CLI and the transitive Android runtime to **8.4.3**. Pin the Swift manifest and resolution to the same release and its upstream tag commit `89e0d8ec2321025f549ddb19259a717467943b97`.
- Fix the [critical Capacitor HTTP proxy advisory](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv). The maintainer requires rebuilding and redistributing the native app; the earlier 1.23.0 (51) binary is not patched by these source changes.
- Update runtime dependencies to Express **4.22.3**, body-parser **1.20.8**, qs **6.16.0**, proxy-addr **2.0.8** and DOMPurify **3.4.16**.
- Update development/build dependencies to Sharp **0.35.5**, Handlebars **4.7.10**, concurrently **9.2.5** with shell-quote **1.12.0**, source-map-js **1.2.2**, Undici **7.30.0**, xmldom **0.9.12**, and Vitest/mocker **4.1.11**.
- Update both installed brace-expansion families within their compatible ranges: **2.1.7** and **5.0.12**. Keep the macOS ARM64 libSQL and Lightning CSS platform pins intact.
- Extend the alignment gate to validate the native Swift manifest/tag revision and the transitive Android pin, and update the existing native configuration regression assertion.
- Increment frontend/lockfile and all four app/extension marketing versions to **1.23.1** under the README's security patch policy.
- Harden CI with read-only repository permissions and the keep-warm workflow with no repository permissions, resolving three existing CodeQL workflow warnings in [PR #79](https://github.com/Ezaz-Ahmad/WagesTracker/pull/79).

The approved branding, Settings/About, 48-hour update reminders, tab visibility and wage calculations remain unchanged. No database migration, new permission, or new data collection is introduced.

## Verification and delivery

The updated lockfile reports **zero vulnerabilities with `npm audit`**. All **35 baseline dependency advisories** were checked against the installed npm versions and resolved Swift tag, with the previous source as a negative control. GitHub reported **zero open Dependabot and CodeQL alerts** after merge on 11 October 2026; newly published findings can change those queues.

Verification passed **294 backend tests**, **861 frontend tests**, **3 Universal Link tests**, **8 distribution-inspection tests**, **15 production-browser scenarios**, TypeScript checks, normal/iOS web builds, deterministic brand verification, and native configuration/single-runtime gates. Fresh macOS sync and the Simulator build passed, including **40 native Live Activity layouts**. Actions, JavaScript/TypeScript and Swift CodeQL analysis all passed on the security patch.

- [Protected-main PR #78 CI](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38119707304)
- [Native Simulator verification](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38119707310)
- [Three-language CodeQL verification](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38119707344)
- [Signed TestFlight delivery](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38121118588)

Build **1.23.1 (52)** was produced from protected-main source **`d54eb41579a4b76fd56335e43b829444e7a3efa4`**, tagged `v1.23.1`. Apple validation succeeded at **07:26:32 UTC**, upload at **07:28:02 UTC**, and temporary signing material was removed. App Store Connect confirmed completed processing and assignment to **WagesTracker Internal Testers**. Vercel and Render deployed the same patched application source; production API health and Universal Link association checks passed.

Apple accepted App Review submission **`e08bed98-479f-4cff-befc-11c5c3af39c6`** at **07:37 UTC / 18:37 AEDT on 11 October 2026**, showing **Waiting for Review** for **1.23.1 (52)**. The submitted metadata uses **Wages Tracker**, one clean description, release notes and reviewer instructions. Existing accurate screenshot assets, privacy declarations, review credentials/contact fields and ratings were preserved. Release is automatic after approval, immediately to all users.

The public Australian App Store version was still **1.21.0** at submission verification. The native update prompt follows Apple's public catalog after publication; existing 1.21.0 users need one ordinary App Store update to acquire the checker. Physical-device tests are separate from the automated and submission evidence. See the [signed delivery guide](ios-testflight-delivery.md) and [App Review guide](app-store-review.md).
