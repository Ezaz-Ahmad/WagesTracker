# Wages Tracker 1.23.1

Security patch candidate prepared **11 October 2026** for a fresh iPhone build and App Review. This document does not yet claim a successful upload or submission.

## Changes

- Update Capacitor core, iOS, CLI and the transitive Android runtime to **8.4.3**. Pin the Swift manifest and resolution to the same release and its upstream tag commit `89e0d8ec2321025f549ddb19259a717467943b97`.
- Fix the [critical Capacitor HTTP proxy advisory](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv). The maintainer requires rebuilding and redistributing the native app; the earlier 1.23.0 (51) binary is not patched by these source changes.
- Update runtime dependencies to Express **4.22.3**, body-parser **1.20.8**, qs **6.16.0**, proxy-addr **2.0.8** and DOMPurify **3.4.16**.
- Update development/build dependencies to Sharp **0.35.5**, Handlebars **4.7.10**, concurrently **9.2.5** with shell-quote **1.12.0**, source-map-js **1.2.2**, Undici **7.30.0**, xmldom **0.9.12**, and Vitest/mocker **4.1.11**.
- Update both installed brace-expansion families within their compatible ranges: **2.1.7** and **5.0.12**. Keep the macOS ARM64 libSQL and Lightning CSS platform pins intact.
- Extend the alignment gate to validate the native Swift manifest/tag revision and the transitive Android pin, and update the existing native configuration regression assertion.
- Increment frontend/lockfile and all four app/extension marketing versions to **1.23.1** under the README's security patch policy.

The approved branding, Settings/About, 48-hour update reminders, tab visibility and wage calculations remain unchanged. No database migration, new permission, or new data collection is introduced.

## Verification and delivery

The updated lockfile reports **zero vulnerabilities with `npm audit`**, compared with the dated 35-alert GitHub baseline. Local verification passed **294 backend tests**, **861 frontend tests**, **3 Universal Link tests**, **8 distribution-inspection tests**, **15 production-browser scenarios**, TypeScript checks, normal/iOS web builds, deterministic brand verification, and the Capacitor single-runtime and native configuration gates. Windows copied the native web bundle but Capacitor reported an error rewriting the managed Swift manifest; the checked-in manifest is aligned, and fresh macOS sync/Simulator validation remains required. Required CI, native Simulator/CodeQL checks and a fresh signed upload must pass before selecting this version for App Review. The live GitHub advisory queue will be checked after the patch reaches protected main.

The latest verified upload remains **1.23.0 (51)** from [run 38116854116](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/38116854116) until the new delivery is recorded. The public Australian App Store version remains **1.21.0**. See the [signed delivery guide](ios-testflight-delivery.md) for the release and physical-device checks.
