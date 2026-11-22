# WagesTracker 1.27.0

Shift-overlap warnings compare the attempted change with saved work, including job and location names, full dates, AM/PM times and explicit overnight end dates. Multiple conflicts are shown in chronological order. Running-shift warnings identify the job and when it started. Create, edit, clock-out and transaction conflict responses follow the same contract; rejected edits retain saved records and unsaved input.

Editing a saved shift's second time field while an earlier save finishes no longer discards the newer draft.

Error popups use specific titles and relevant guidance for validation, sign-in, connection, timeout, rate-limit, missing-record and concurrent-edit failures. Server failures no longer tell users to fix an unspecified field. Required-field errors name and focus the relevant input. The shared presentation covers the consumer app and web admin.

The popup uses a short transform/opacity entrance and exit, a scrollable content area and a stable action. Reduced motion is respected. Duplicate errors are coalesced, a closing popup cannot clear a newer error, and the same action failure is no longer repeated in a global banner behind its popup. Only the top dialog handles Escape/Tab, and nested scroll locks survive editors closing or sessions expiring underneath a warning.

Conflict details contain only the caller's schedules and necessary display fields. Restricted Lock Screen action credentials receive an instruction to review the app without disclosure of other jobs or schedules. Malformed error metadata falls back to an ordinary readable error.

The health check retains its existing JSON response and includes a validated public source-revision header when Render supplies it. This supports exact production rollout verification without relying on a stale deployment callback or exposing credentials.

Validation covers API ownership, overnight and adjacent shifts, multiple conflicts, edit rollback, active jobs and scoped credentials; popup accessibility, focus, motion and replacement timing; real API journeys in Chromium and iPhone WebKit across phone, compact phone and desktop sizes; the full backend/frontend suites, dependency audit, native launch/resume and security analysis. Delivery receipts are recorded in the release pull request.
