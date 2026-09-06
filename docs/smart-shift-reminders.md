# Smart Shift Reminders

**Status:** source-complete; native device regression required before release

**Last reviewed:** 6 September 2026

## Product contract

Smart Shift Reminders are off by default under **Settings → Profile & preferences**. Enabling them on iOS requests ordinary alert/sound permission. A denied or unavailable permission never changes a shift and schedules nothing.

The feature may notify only when all reliability gates pass:

- at least four usable completed shifts exist for the same weekday;
- recent occurrences mostly have a seven-day cadence, preventing a fortnightly or occasional shift from becoming an assumed weekly schedule while tolerating an occasional missed week;
- at least 75% of usable rows agree within 45 minutes at sign-in and 60 minutes at sign-out;
- the accepted cluster spans no more than 60 minutes at the start or 90 minutes at the finish;
- each row is a single-shift day and is between one and sixteen hours long;
- the routine has a completed occurrence within the last 21 days, so an old job pattern cannot remain active indefinitely.

The median accepted start and finish are rounded to five minutes for professional notification copy. Overnight finishes are represented relative to the shift's starting date, then displayed as the correct next-day wall-clock time.

Learning uses existing completed history immediately, including shifts entered after the fact and shifts whose start or finish minutes were corrected. This matches normal wage-recording behaviour: editing an exact minute is not evidence that the shift is unreliable. Reliability comes from the weekday cadence and the agreement between the recorded times themselves. Up to the latest twelve completed occurrences per weekday are considered, rather than limiting established users to records created after opt-in or to a fixed eight-week window.

The Settings card distinguishes three states: a new account is **Learning quietly**, partial history reports progress such as **3 of 4 Monday shifts recorded**, and a reliable routine becomes **Ready — learning complete** with its learned start and finish preview. Four or more completed occurrences with inconsistent timing are reported as history found but not yet safe enough for a reminder.

## Scheduling and timezone behaviour

The React client uses the device's current IANA timezone and creates a maximum seven-day schedule. Notifications are one-shot `UNTimeIntervalNotificationTrigger` requests, never repeating weekday rules. Every app start, resume, connectivity refresh and shift mutation rebuilds the schedule from current server data. Starting a shift removes that day's sign-in reminder; ending a shift removes the corresponding sign-out reminder.

Both reminder types use a 20-minute grace period. If an open shift is discovered shortly after its expected finish, the alert is scheduled one minute later; after four hours the state is considered ambiguous overtime/overnight work and no stale alert is created.

The short horizon is deliberate. iOS can still deliver the requests while the WebView is suspended or the app is closed, without an APNs provider, background polling job or server-held device token. If the phone changes timezone, the next app foreground refresh regenerates the horizon in the new zone.

## Notification actions and safety

Missed sign-in alerts expose **Sign In**, **Remind Me Later**, and **Dismiss**. Missed sign-out alerts expose **Sign Out**, **Remind Me Later**, and **Dismiss**.

- **Sign In/Sign Out:** requires device authentication, foregrounds Wage Tracker, and stores only a small pending action intent. It never calls the API. The app then rechecks current shift state and requires a second explicit confirmation. Sign In also requires an active work location.
- **Remind Me Later:** schedules one new notification after 15 minutes because the user explicitly requested it.
- **Dismiss:** performs no follow-up action.

The sign-out confirmation calls the same authenticated, atomic `/api/shifts/:id/clock-out` route as the normal Entry button. Replays cannot replace the first accepted finishing time. No full session token is placed inside notification content or native reminder persistence.

## Release verification

Automated coverage exercises minimum-history, historical/manual entries, weekday cadence, outliers, split shifts, overnight patterns, learning progress, grace periods, stale reminders, preference persistence and explicit action confirmation. Before release, verify on a physical iPhone:

1. Enable the setting and grant notification permission.
2. Confirm a reliable weekday shows in Settings and its next sign-in alert is pending.
3. Start a shift before the alert; confirm the pending sign-in request disappears.
4. Leave a shift open past its learned finish; verify personalised copy and all three actions.
5. Tap Sign Out; unlock the phone if asked, then confirm the app still requires the in-app **Confirm Sign Out** tap.
6. Tap **Remind Me Later** on another alert and verify one follow-up appears about 15 minutes later.
7. Deny notification permission and verify shift entry remains fully usable with no alert scheduled.
8. Change device timezone, foreground the app, and verify newly scheduled requests use the new local wall-clock time.

Windows CI can validate TypeScript, API, bridge registration and source invariants, but Apple framework compilation and delivery require the repository's macOS/iOS build path.
