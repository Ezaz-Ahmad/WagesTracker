# WagesTracker 1.26.0

The job picker uses a continuous entrance and exit, immediate selection feedback, clearer cards and fixed actions that stay accessible in long lists. Changing views or opening job management waits for the picker to close. Reduced motion switches immediately, keyboard focus returns correctly, and hidden pay is labelled without exposing the rate. The picker remains available on all main tabs except Settings.

Support links to https://www.ezazahmad.com/ and explains where to find the contact option.

Fonts ship with the app to improve offline rendering and avoid an extra provider request at startup. The web deployment adds framing, content-type, referrer and base/object protections. Email validation and smart reminders avoid newer array methods unavailable on the oldest supported iOS versions. Startup uses an async function compatible with the build target and shows a reload action if platform setup or a page chunk fails.

Requests have a deadline covering both the connection and response body. Failed or malformed responses produce recoverable errors. Timed-out writes are never automatically retried. Admin sessions work in memory when browser storage is blocked, while normal cross-tab logout remains effective.

Security updates address known dependency advisories, including request-parser crashes, validation resource exhaustion, sanitization and development-tool issues. The API rate-limits before parsing, rejects unnecessary compressed request bodies and returns safe parser errors without logging submitted credentials. Expense edits preserve omitted values after the validation-library upgrade. CI, signed delivery and the deployment configuration check dependency advisories before release.

Validation includes the full API and frontend suites, production browser journeys, a real isolated API journey in Chromium and iPhone WebKit, employer PDF export and rendering, native Simulator launch/resume and Live Activity checks, dependency audit and CodeQL. JavaScript targets Safari 15 alongside the existing iOS 15 deployment minimum; signed app and widget builds continue to require SDK 27 or newer.

Release build, source revision and Apple/TestFlight availability are recorded in the release pull request and delivery workflow receipt.
