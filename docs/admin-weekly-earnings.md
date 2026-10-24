# Admin panel: weekly earnings

The admin dashboard now shows what each user earned in the running week and earlier weeks, alongside daily earnings charts. Open `/admin` with the existing admin login.

## What changed

- An overview shows account count, combined earnings and completed hours for the selected weeks.
- Each directory entry shows the selected and previous week's earnings, actual date ranges, completed hours and a compact daily chart.
- Admins can search accounts, sort by earnings/name/shift count, refresh, and browse weeks using arrows or a date picker.
- Opening a user starts in the earnings explorer: select a recorded week or use the arrows to visit any earlier week, including weeks with no records.
- The user view includes wages, fuel, weekly extras, previous-week comparison, earnings-goal progress and unfinished-shift counts.
- Daily charts compare the selected week with the previous week. Hover, tap or use arrow keys to inspect a day; an expandable table provides exact figures.
- Account details, login-email editing, shift history and confirmed deletion remain available. Account tools are in the **Account & shifts** view.
- Responsive mobile cards, theme-aware styling, animated chart bars, entry transitions, loading placeholders and reduced-motion support improve the panel across screen sizes.
- Request sequencing prevents stale user/week responses from replacing the current view. Errors provide retry controls.

## Calculation rules

The dashboard uses the same persisted earnings rules as existing reports: completed shift hours multiplied by the user's **current hourly rate**, plus daily fuel and weekly extras. Historical pay rates are not stored, so older weeks also use the current rate. Unfinished shifts contribute no wages.

Each account's configured first day of the week is respected, including all seven weekday choices. The admin device supplies the calendar date for week selection. The overview may combine different date ranges when users choose different first days; each entry displays its exact range.

An overnight shift belongs to its recorded starting date. Daily bars include wages and fuel; weekly extras are shown separately because they have no daily allocation. Weekly totals are calculated before cent rounding, so the sum of rounded daily labels can differ by a cent. The running-week comparison uses the full previous week, and the panel states that the current week is still in progress.

## API and rollout

- `GET /api/admin/users?date=YYYY-MM-DD` adds `earnings` and `previousEarnings` to each existing public user summary.
- `GET /api/admin/users/:id/earnings?date=YYYY-MM-DD` returns the selected week, previous week and recorded week choices.
- Both endpoints require an admin token and validate real calendar dates. User-detail earnings queries are scoped to that account; password hashes and other credentials are excluded.
- Directory earnings use three bounded data reads in addition to the existing user/count query, rather than a query for every user. History discovery returns week keys rather than full shift records.
- No database migration, package dependency, environment variable or admin-login change is required. Deploy the backend before or alongside the frontend so the earnings endpoint is available.

## Verification

Automated coverage checks admin authorization, account isolation, seven week-start settings, overnight and unfinished shifts, rounding, fuel/extras, historical and empty weeks, invalid input, chart interaction, accessibility and request failure handling. Production browser coverage exercises desktop and narrow mobile layouts, week navigation and existing account tools.

Local validation completed on 24 October 2026:

- Backend: 313 tests passed.
- Frontend: 877 tests passed, plus 3 Apple link-configuration tests.
- Production browser smoke suite: 19 tests passed, including 4 new admin scenarios at 1440px, 390px and 320px widths.
- Backend/frontend typechecks and production builds passed.
- Visual review checked light and dark appearances, mobile padding/email wrapping, and chart reveal after scrolling into view.
