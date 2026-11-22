# Wages Tracker 1.27.0

Released to internal TestFlight on **22 November 2026** as **1.27.0 (58)**. Source release `v1.27.0` identifies the exact application commit used for that binary. The public App Store version remains separate.

Shift-overlap warnings compare the attempted change with saved work, including job and location names, full dates, AM/PM times and explicit overnight end dates. Multiple conflicts are shown in chronological order. Running-shift warnings identify the job and when it started. Create, edit, clock-out and transaction conflict responses follow the same contract; rejected edits retain saved records and unsaved input.

Editing a saved shift's second time field while an earlier save finishes no longer discards the newer draft.

Error popups use specific titles and relevant guidance for validation, sign-in, connection, timeout, rate-limit, missing-record and concurrent-edit failures. Server failures no longer tell users to fix an unspecified field. Required-field errors name and focus the relevant input. The shared presentation covers the consumer app and web admin.

The popup uses a short transform/opacity entrance and exit, a scrollable content area and a stable action. Reduced motion is respected. Duplicate errors are coalesced, a closing popup cannot clear a newer error, and the same action failure is no longer repeated in a global banner behind its popup. Only the top dialog handles Escape/Tab, and nested scroll locks survive editors closing or sessions expiring underneath a warning.

Conflict details contain only the caller's schedules and necessary display fields. Restricted Lock Screen action credentials receive an instruction to review the app without disclosure of other jobs or schedules. Malformed error metadata falls back to an ordinary readable error.

The health check retains its existing JSON response and includes a validated public source-revision header when Render supplies it. This supports exact production rollout verification without relying on a stale deployment callback or exposing credentials.

## Verification and delivery

- [Clean CI](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44975024697): **355 backend tests**, **925 tracked frontend tests**, **3 Universal Link tests** and **41 production-browser scenarios**, with type checks and builds. Browser coverage includes real isolated API journeys in Chromium and iPhone WebKit at phone, compact phone and desktop sizes, plus existing employer PDF and admin flows.
- Coverage includes ownership, overnight/adjacent shifts, multiple conflicts, edit rollback, active jobs and scoped credentials; dialog accessibility, focus, motion, replacement timing and retained drafts. The dependency audit reports **zero known vulnerabilities** for the checked lockfile.
- [Native QA](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44975024753): cold launch with rendered UI, resume without restart and **40 Live Activity layouts**. Both app and widget verify SDK **27.2**. The distribution/SDK/TestFlight regression suite passes **26 tests**.
- [CodeQL](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44975024732): JavaScript/TypeScript, Actions and Swift all pass. [Protected-main CI](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44976313809) and [native QA](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44976313822) pass after merge.
- [Signed delivery](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44976336305) from **`d5cdd4a859ea5aa5ef1414de1a6edba7c1a77a10`** validates and uploads **1.27.0 (58)**. Apple confirms processing **VALID**, internal state **IN_BETA_TESTING**, and availability to **WagesTracker Internal Testers**. App and widget use **`iphoneos27.2`**; temporary signing material was removed.
- Production web and API rollout was verified against the same application source. The API health check returned that exact public source revision with `Cache-Control: no-store`; verification did not create production accounts or records.

The merged implementation and delivery receipt are in [PR #96](https://github.com/Ezaz-Ahmad/WagesTracker/pull/96). Documentation changes after the tagged application commit do not change build 58. No public App Store submission was made for this version. Apple's [Australian listing](https://apps.apple.com/au/app/wages-tracker/id6801702467), checked on 22 November 2026, shows **1.23.1**, published 11 October 2026.

For changes introduced since the preceding GitHub release, including multi-job/location pay, permanent job deletion, Settings/public pages, the iOS SDK migration and security improvements, see the [change history](../CHANGELOG.md). Physical-device checks remain in the [delivery guide](ios-testflight-delivery.md#physical-device-release-checklist).
