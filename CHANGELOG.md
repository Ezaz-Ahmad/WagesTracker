# Change history

The current application version is **1.27.0**, available on the web and as **1.27.0 (58)** to internal TestFlight testers. Apple's public App Store version is **1.23.1** as checked on 22 November 2026. Source releases, TestFlight delivery and public App Store publication are separate milestones.

## 1.27.0 — 22 November 2026

- Compare conflicting shifts with job/location names, full dates, exact times and overnight end dates; identify an already running job and its start time.
- Give validation, sign-in, connection, timeout, service and concurrent-edit failures specific guidance in the app and admin panel.
- Refine popup motion, scrolling, fixed actions, focus, reduced motion and duplicate suppression. Keep newer drafts when earlier saves finish.
- Restrict conflict details to the caller; keep other schedules private from scoped Lock Screen action credentials.
- Verify production API rollout through a validated public revision header.

**Delivery:** [PR #96](https://github.com/Ezaz-Ahmad/WagesTracker/pull/96), source [`d5cdd4a`](https://github.com/Ezaz-Ahmad/WagesTracker/commit/d5cdd4a859ea5aa5ef1414de1a6edba7c1a77a10), TestFlight **58**, processing **VALID**, **IN_BETA_TESTING**. See [full release notes and checks](docs/release-notes-1.27.0.md).

## 1.26.0

- Smooth job-picker entrance/exit and selection feedback, with fixed actions, focus restoration and reduced motion. Keep the picker on main tabs except Settings.
- Point Support to [ezazahmad.com](https://www.ezazahmad.com/), where contact is available at the bottom of the page.
- Bundle fonts, recover from startup/load failures, bound request timeouts and preserve admin access when browser storage is blocked.
- Update dependencies and harden request parsing, web response headers and Safari 15 compatibility.

**Delivery:** [PR #95](https://github.com/Ezaz-Ahmad/WagesTracker/pull/95), TestFlight **57**. See [release notes](docs/release-notes-1.26.0.md).

## 1.25.0

- Replace new job archival actions with permanent deletion, including an impact preview, exact-name confirmation, running-shift guard and safe final-job empty state.
- Remove personal-spending content from All jobs Home and the workspace picker from Settings; use Your jobs to manage the selected employer.
- Reorganize Privacy and Support with a persistent return control.
- Adopt stable Xcode/SDK **27.2**, Capacitor **8.6.2** and a single scene-owned native window; inspect actual app/widget SDKs before delivery.

**Delivery:** [PR #93](https://github.com/Ezaz-Ahmad/WagesTracker/pull/93), with the follow-up scene migration, TestFlight **56**. See [release notes](docs/release-notes-1.25.0.md).

## 1.24.0

- Add multiple jobs with separate locations, effective-dated pay, shifts, fuel, extras, goals, weekly cycles and reminders.
- Allow different rates at each location, inheritance from a job default and reviewed corrections while preserving recorded shift pay.
- Add combined and employer-specific PDF exports with per-shift rates and wages; keep personal spending in one ledger with optional job tags.
- Extend admin earnings, reminders and Live Activities with job context.

**Delivery:** TestFlight **55**, confirmed available after Apple agreement recovery. See [release notes](docs/release-notes-1.24.0.md) and [delivery history](docs/ios-testflight-delivery.md#earlier-delivery-records).

## 1.23.1 — 11 October 2026

Native/runtime security fixes and workflow permission hardening. This was the preceding published GitHub release and is the current public App Store version at this review. See [historical release notes](docs/release-notes-1.23.1.md) for its source, checks and submission-time receipt.

Earlier history: [1.23.0](docs/release-notes-1.23.0.md), [1.22.0](docs/release-notes-1.22.0.md), and [GitHub releases](https://github.com/Ezaz-Ahmad/WagesTracker/releases).
