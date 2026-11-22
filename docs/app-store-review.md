# Submit an iPhone update for App Review

Use the existing Wages Tracker app in App Store Connect, Apple ID `6801702467`, bundle ID `com.ezazahmad.wagestracker`. A TestFlight upload and a GitHub release do not submit a public App Store update.

**Last reviewed:** 22 November 2026. Apple's [Australian listing](https://apps.apple.com/au/app/wages-tracker/id6801702467) confirms **Wages Tracker 1.23.1**, published 11 October 2026. The 1.23.1 (52) submission showed **Waiting for Review** at 07:37 UTC / 18:37 AEDT that day; that is a historical receipt, not the current public state. See [its release evidence](release-notes-1.23.1.md).

**Current beta:** **1.27.0 (58)** is processed and available to internal TestFlight testers. It has not been submitted for public App Review. Publishing source documentation or a GitHub release does not submit it. See [current delivery evidence](release-notes-1.27.0.md#verification-and-delivery).

1. Choose the marketing version under the [README version policy](../README.md#versioning-and-releases), align frontend/lockfile and all four app/extension Xcode versions, and pass the release checks on protected main.
2. Upload a fresh signed build using the [TestFlight workflow](../.github/workflows/ios-testflight.yml). Record the exact source, marketing/build pair, Apple validation/upload results, processing state and tester assignment. Use a new workflow dispatch rather than Re-run jobs.
3. Open Distribution in App Store Connect and add that iOS version. Verify the inherited screenshot assets and App Review sign-in/contact fields. Keep credentials in App Store Connect; do not publish them in GitHub, documents, screenshots or logs.
4. Update the App Information name and localized metadata as needed. Supply one clean description, the current What's New, working Support/Privacy URLs, copyright and concise reviewer instructions for new features.
5. Verify the privacy declarations and age rating against the actual app. Select the processed build with the matching version; confirm the build number, release name/icon and export-compliance status.
6. Choose the release option for this submission. The previous release used automatic publication after approval and immediate availability to all users; verify the intended choice before submitting a new version. Keep existing ratings unless the owner explicitly requests a reset.
7. Click Add for Review. This stages a submission as Ready for Review. Open the draft submission under App Review and click Submit for Review.
8. Verify Waiting for Review and save a screenshot of the status/version/build without sign-in or contact credentials. Record the source and submission receipt in the release documentation.

Before a future 1.27.0 submission, reconcile the description, screenshots, reviewer instructions and privacy questionnaire with multi-job data, location pay, recorded rates, deletion impact and clearer conflict guidance. TestFlight delivery alone does not update those declarations.

Apple approval and publication happen afterward. The App Store lookup used by the native update prompt changes when the public version becomes available. The checker is included in public 1.23.1; older installations need an ordinary App Store update to obtain it. Future public releases use the installed-versus-public comparison and 48-hour Not now reminder.

Official instructions: [submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app), [create a new version](https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version), and [select the release option](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/).
