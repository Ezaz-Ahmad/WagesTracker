# Tab visibility

Introduced in Wages Tracker **1.23.0**. Open **Settings → Profile & preferences → App layout → Tab bar** to arrange, hide, or restore tabs. Settings always stays available, including when every optional tab is hidden.

## Confirmation and recovery

Hiding a tab opens a focus-managed confirmation with **Keep tab** and **Hide <tab>** actions. Escape and backdrop dismissal cancel the change. Showing a hidden tab is immediate. Reset shows every tab in its default order without resetting Home widgets.

| Tab | Tools hidden | Calculation and data impact |
| --- | --- | --- |
| Home | Weekly overview, goals, and Home shortcuts | Saved shifts and earnings keep calculating |
| Entry | Manual shifts, fuel adjustments, and extra earnings | Existing hours, fuel allowances, and extras still count |
| Spending | Expense entry, categories, insights, and the Home spending snapshot | Personal spending remains saved and is separate from wages |
| Report | Current-week summaries and wage PDF downloads | Hours, wages, and saved records are preserved |
| History | Past weeks, saved-shift editing, and historical PDFs | Past records remain saved and contribute to earnings |

When hiding Home or Entry removes the remaining in-app clock controls, the confirmation explains how to restore Home, Entry, or the Today's shift widget. An active shift continues running. Existing native reminders and Live Activities are not disabled by a tab visibility preference.

## Persistence and navigation

Preferences extend the existing `wagesTracker.layout.v1:<userId>` local-storage record on that device. Existing layouts without `hiddenTabs` retain all tabs. Invalid or duplicate IDs are repaired; Settings is excluded from the hidden set. Preferences are isolated between accounts and respond to changes from another window.

Mobile menus, desktop navigation, swipes, launch selection, and explicit navigation use visible tabs. If the requested screen becomes hidden, the app uses Home when available, otherwise the first visible tab. Settings is the fallback when it is the only visible tab.

Reordering operates on visible tabs while retaining hidden slots. Restoring Spending respects the user's separate Home widget preference; it does not force a previously hidden snapshot to appear. Home's spending summary fetch is disabled while the Spending tab is hidden.

## Verification

Component and navigation tests cover recovery, storage normalization, account isolation, persistence, ordering, focus return, confirmation/cancellation, and shift-control warnings. A production-browser regression checks unchanged displayed weekly wages, zero account-data writes, hiding Spending, reload, and restoration. Browser previews cover dark/light phone layouts, compact phones, landscape, tablet, and desktop. Physical iPhone installation and gesture checks follow TestFlight processing.
