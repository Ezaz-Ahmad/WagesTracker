# Wages Tracker 1.28.0

Job selection moves to a compact briefcase beside the earnings-privacy button. The selected job remains visible beside the date. Settings continues to use Your jobs, with no header picker. Phone logout uses a compact icon with its existing accessible label and confirmation; wider layouts retain the text label.

The picker opens beneath the header with a short fade, translation and scale, and closes before switching views or opening job management/the add-job form. It remembers the existing selection and uses cached work data. Long job lists scroll while Add job and Manage jobs stay available. The panel responds to viewport changes, supports keyboard focus and Escape, restores focus on dismissal and respects reduced motion. Archived-job context and notices about a running shift at another job remain available below the header.

Deleting the last job is blocked. A clear warning names the job, explains that at least one job is needed to track shifts and pay, and offers Add another job or Keep job. The add action waits for the warning to close before presenting the form. No records are removed. An archived job cannot serve as the only replacement for the active job.

The API enforces the same invariant inside the write transaction before any related record is deleted. Stale clients and competing deletions receive `409 LAST_JOB_REQUIRED` with readable guidance; one usable job survives. Ownership checks, exact-name review, running-shift protection, cascade rollback and primary-job promotion remain in place. Accounts already empty from an earlier version retain their add-job recovery.

Validation covers real API deletion/switching/add-job journeys in Chromium and iPhone WebKit at 390px and 320px; long picker lists, fixed actions, responsive positioning, motion and focus; last-job preservation, stale reviews, archived alternatives and competing API requests; the full API/frontend/browser suites, native launch/resume, Live Activity layouts, distribution checks, dependency audit and security analysis.

The release pull request and [GitHub release receipt](https://github.com/Ezaz-Ahmad/WagesTracker/releases/tag/v1.28.0) record the exact signed source, fresh TestFlight build number and verified Apple/internal tester availability. A TestFlight upload does not submit a public App Store update.
