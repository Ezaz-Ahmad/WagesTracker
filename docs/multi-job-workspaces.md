# Jobs, location pay and reporting

Each account owns one or more jobs. A job owns its locations, hourly pay schedule, weekly goals, work-week boundary, shifts, daily fuel allowances and weekly extras. Personal spending remains one account ledger with an optional job tag.

## User experience

- The workspace picker sits below the app header on web and iOS. It switches cached job data immediately and remembers the selection per account on the device.
- All jobs uses the same Monday–Sunday date range for every job. Its total includes archived jobs' records in that period; goals follow active jobs unless an overall target is saved.
- Settings → Your jobs creates, renames, archives and restores jobs. Archiving retains shifts and reports, requires another active job and refuses a running shift.
- Settings → Work & pay edits the selected job's default pay and each location's override, including effective dates and a return to the default. A same-date replacement requires review. Saved and running shifts retain their recorded pay.
- History allows an explicit saved-rate correction with a before/after confirmation. Combined and archived history is read-only.
- Combined report exports offer a personal summary or one employer's work week. Employer exports include only that job's shifts, fuel and extras. Filenames include the report scope.
- Spending tags filter the personal ledger; the earnings comparison remains account-wide and is labelled accordingly.
- Admin shows job counts, job/location/pay history, recorded rates on shifts and combined or per-job weekly earnings. Financial settings remain in the user's reviewed pay flow.

## Pay rules

For a new shift, the worked date selects the latest location pay record effective on or before that date. A null location rate means inherit the job default effective on that date. The selected rate is saved as integer cents with its source and job name. Backdated entries use their worked date; changing a schedule never changes existing snapshots, including running shifts.

Completed shift wages are rounded to cents once per shift, then summed. Incomplete shifts add no persisted wages. Live estimates use the running shift's snapshot. Home, Entry, History, Report, spending comparisons, PDF and admin use the same rule.

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

Before release, complete the unsigned iOS Simulator workflow and signed TestFlight delivery, then check on a physical iPhone: keyboard/safe areas, job switching, per-location entry, pay review, PDF sharing, reminders, Live Activity and overnight clock-out. Desktop browser emulation does not replace this device check.
