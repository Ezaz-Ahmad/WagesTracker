# Admin panel: weekly earnings

**Applies to:** 1.27.0 · **Last reviewed:** 22 November 2026

The admin dashboard shows what each user earned in the selected week and earlier weeks, with combined or per-job breakdowns and daily charts. Open `/admin` with the separate admin password; a regular user session cannot access these routes.

## What changed

- An overview shows account count, combined earnings and completed hours for the selected weeks.
- Each directory entry shows the selected and previous week's earnings, actual date ranges, completed hours and a compact daily chart.
- Admins can search accounts, sort by earnings/name/shift count, refresh, and browse weeks using arrows or a date picker.
- Opening a user starts in the earnings explorer: select a recorded week or use the arrows to visit any earlier week, including weeks with no records.
- The user view includes wages, fuel, weekly extras, previous-week comparison, earnings-goal progress and unfinished-shift counts.
- Job counts distinguish total and active jobs. The earnings explorer can select **All jobs** or one owned job, and account details show locations, pay schedules and each shift's recorded hourly rate and wages. Financial changes remain in the user's reviewed pay flow.
- Daily charts compare the selected week with the previous week. Hover, tap or use arrow keys to inspect a day; an expandable table provides exact figures.
- Account details, login-email editing, shift history and confirmed deletion remain available. Account tools are in the **Account & shifts** view.
- Responsive mobile cards, theme-aware styling, animated chart bars, entry transitions, loading placeholders and reduced-motion support improve the panel across screen sizes.
- Request sequencing prevents stale user/week responses from replacing the current view. Shared warnings distinguish authentication, connection and service failures and give an appropriate next step. Login remains usable in memory if browser storage is blocked.

## Calculation rules

The dashboard uses the same persisted earnings rules as user reports and PDFs: elapsed seconds multiplied by each shift's **recorded rate in cents**, divided by 3,600 and rounded once per shift, then summed with daily fuel and weekly extras. Later pay changes do not rewrite historical wages. Unfinished shifts contribute no wages. The multi-job migration pins older shifts to the account rate known at migration; earlier rates cannot be reconstructed from the previous data model.

Single-job accounts and explicitly selected jobs use their configured first day of the week, including all seven choices. Multi-job accounts use Monday–Sunday for combined totals, so every job contributes over the same date range. The admin device supplies the calendar date for week selection, and each entry displays its exact interval. The overview can therefore contain account entries with different week boundaries.

An overnight shift belongs to its recorded starting date. Daily bars include wages and fuel; weekly extras are shown separately and selected by their stored effective date. The monetary breakdown reconciles wages, fuel and extras to the displayed total. The running-week comparison uses the full previous week, and the panel states that the current week is still in progress.

## API and rollout

- `GET /api/admin/users?date=YYYY-MM-DD` returns `earnings`, `previousEarnings`, `jobCount` and `activeJobCount` with each public user summary.
- `GET /api/admin/users/:id/earnings?date=YYYY-MM-DD&jobId=all` returns the selected week, previous week, recorded week choices and job breakdowns. Replace `all` with an owned job ID for that employer's week; an unrelated job is rejected.
- Both endpoints require an admin token and validate real calendar dates. User-detail earnings queries are scoped to that account; password hashes and other credentials are excluded.
- Directory earnings use three bounded data reads in addition to the existing user/count query, rather than a query for every user. History discovery returns week keys rather than full shift records.
- Multi-job schema/data migration is part of the current backend initialization. It preserves existing work and records applied rates; see the [workspace migration rules](multi-job-workspaces.md#migration-and-compatibility). Deploy backend and frontend changes together. The separate `ADMIN_PASSWORD` login configuration is unchanged.

## Verification

Automated coverage checks admin authorization, account/job isolation, seven week-start settings, mixed recorded rates, overnight and unfinished shifts, rounding, fuel/extras, historical and empty weeks, invalid input, chart accessibility and request recovery. Production browser journeys exercise desktop and narrow mobile layouts, job/week navigation and existing account tools.

The [1.27.0 CI receipt](https://github.com/Ezaz-Ahmad/WagesTracker/actions/runs/44975024697) verifies **355 backend tests**, **925 frontend tests**, **3 Universal Link tests** and **41 browser scenarios**, with type checks and production builds. These are full-suite totals, not admin-only counts. See [current release evidence](release-notes-1.27.0.md#verification-and-delivery).
