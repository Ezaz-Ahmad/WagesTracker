# Jobs, location pay and reporting

**Applies to:** 1.27.0 · **Last reviewed:** 22 November 2026

Each account can own multiple jobs or have none after deleting its last job. A job owns its locations, hourly pay schedule, weekly goals, work-week boundary, shifts, daily fuel allowances and weekly extras. Personal spending remains one account ledger with an optional job tag.

## User experience

- The workspace picker sits below the app header on web and iOS. It switches cached job data immediately and remembers the selection per account on the device.
- All jobs uses the same Monday–Sunday date range for every job. Its total includes archived jobs' records in that period; goals follow active jobs unless an overall target is saved.
- Settings → Your jobs creates, renames and permanently deletes jobs. The review lists affected shifts, locations, pay records, fuel allowances, extras and linked spending, explains the effect on totals and future PDFs, and requires the exact job name. A running shift blocks deletion. Existing archived jobs can still be restored or deleted; new archive actions are no longer offered.
- Job deletion removes its records in one database transaction, including personal spending tagged to the job. Other jobs, account information and unlinked spending remain. Exported PDFs remain on the user's device. Deleting the last job opens an add-job empty state; a persistent initialization marker prevents migration or refresh from recreating deleted data. Deleting the primary job promotes another job and updates compatibility preferences atomically.
- The job picker remains on work tabs and is hidden in Settings. Choose the job through Your jobs before editing its pay. The All jobs Home overview contains work earnings and goals without a personal-spending shortcut.
- Settings → Work & pay edits the selected job's default pay and each location's override, including effective dates and a return to the default. A same-date replacement requires review. Saved and running shifts retain their recorded pay.
- Tap a saved shift's hourly rate in Entry to correct current-week pay, or use History for earlier weeks. Both require a before/after confirmation; cancelling preserves the draft. Combined and archived history is read-only.
- Combined report exports offer a personal summary or one employer's work week. Employer exports include only that job's shifts, fuel and extras. Filenames include the report scope.
- Spending tags filter the personal ledger; the earnings comparison remains account-wide and is labelled accordingly.
- Admin shows job counts, job/location/pay history, recorded rates on shifts and combined or per-job weekly earnings. Financial settings remain in the user's reviewed pay flow.
- Cross-job overlap warnings compare **Your change** with **Already saved**, including job/location names, full dates, AM/PM times and an explicit next-day end date for overnight work. Multiple conflicts appear chronologically. Running-shift warnings identify the active job and start time. The failed edit keeps its input for correction, without repeating the warning behind the popup.

## Pay rules

For a new shift, the worked date selects the latest location pay record effective on or before that date. A null location rate means inherit the job default effective on that date. The selected rate is saved as integer cents with its source and job name. Backdated entries use their worked date; changing a schedule never changes existing snapshots, including running shifts.

Completed shift wages multiply integer elapsed seconds by integer rate cents, divide by 3,600, then round to cents once per shift and sum. Displayed hours are never used as the calculation's rounded input. Incomplete shifts add no persisted wages. Live estimates use the running shift's snapshot. Home, Entry, History, Report, spending comparisons, PDF and admin use the same rule.

Changing a saved shift's location recalculates its proposed rate for the original worked date; a changed rate requires confirmation. Clearing a location returns to the job default. A manual rate correction affects that shift only. Times-only edits retain the saved rate.

Weekly extras retain their original effective date (the closing day of the original work week). Changing a job's week start reassigns only its extras using those dates. Combined summaries allocate extras to the Monday–Sunday period containing the effective date, preventing double counting across different job boundaries.

## Migration and compatibility

The migration creates a stable primary job from each existing account, assigns its locations, shifts, fuel and extras, and replaces account/date uniqueness with account/job/date uniqueness in a transaction. Old shifts are pinned to the account rate available at migration; earlier rate history cannot be reconstructed because the previous model did not record it. Existing location and allowance snapshots remain intact. Migration retries preserve records.

The `workspacesEnabled` account capability allows a new client to continue loading core data during a rolling deployment against the prior API. An omitted `X-Work-Job` selects the primary job for older clients; explicit `all` is read-only, apart from ending a specific owned running shift. All job/location/rate writes validate ownership server-side. Overlap and the one-running-shift limit apply across jobs, with transactional overlap checks and the existing unique running-shift constraint.

## Native iOS

The Capacitor app uses the same screens and rate calculations. Live Activity labels identify the running job and location. Smart reminders are learned and enabled per job, carry a job ID into the native notification/action payload and select the matching workspace before confirmation. Starting another shift is suppressed while any job has a running shift. PDF delivery uses the existing native share adapter.

## Validation

Automated coverage includes legacy migration preservation/retries, ownership, per-job fuel/extras, cross-job overlap, running-shift limits, effective-date inheritance, frozen pay, explicit corrections, shared spending tags, admin reconciliation and the same mixed-rate totals in every reporting period. Production browser coverage exercises cached switching, report scope, settings navigation and layout at 1280px, 390px and 320px.

The development review uses an isolated local database. The worked example is 25 hours at recorded rates of $30, $34 and $32: $792 wages + $40 fuel + $25 bonus = $857. Two additional jobs produce a combined $1,182. Exported PDFs are rendered and visually checked.

The [1.27.0 release evidence](release-notes-1.27.0.md#verification-and-delivery) records successful unsigned Simulator QA, security checks and signed **1.27.0 (58)** delivery, confirmed available to internal TestFlight testers. Physical-device checks still cover keyboard/safe areas, job switching, per-location entry, pay review, PDF sharing, reminders, Live Activity and overnight conflict/clock-out behavior. Desktop browser emulation does not replace these checks.
