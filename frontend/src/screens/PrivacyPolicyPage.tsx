import { PublicPageShell } from "../components/PublicPageShell";
import { InternalAppLink } from "../components/AppLink";

const LAST_UPDATED = "6 September 2026";

export function PrivacyPolicyPage() {
  return (
    <PublicPageShell
      eyebrow="Privacy"
      title="Privacy Policy"
      summary="Wage Tracker collects only the information needed to run your private account and keep it secure."
    >
      <p className="public-page-updated">Last updated: {LAST_UPDATED}</p>

      <section>
        <h2>Who operates Wage Tracker</h2>
        <p>
          Wage Tracker is developed and operated by Ezaz Ahmad in New South Wales, Australia. This policy applies to
          the Wage Tracker website, installed web app, and mobile applications.
        </p>
      </section>

      <section>
        <h2>Information we collect</h2>
        <p>We collect information you provide or generate while using the service:</p>
        <ul>
          <li><strong>Account information:</strong> your name, email address, and password stored in a protected one-way form.</li>
          <li><strong>Work profile:</strong> home and work addresses, workplace names, pay rate, week-start preference, and weekly goals.</li>
          <li><strong>Work records:</strong> shift dates and times, work locations, expenses, additional earnings, and the data used to create reports.</li>
          <li><strong>Optional personal spending records:</strong> expense amounts, categories, dates and times, merchant or short-title information, notes, and payment-method labels that you choose to enter.</li>
          <li><strong>Signed-in device information:</strong> device or browser type, internet address, sign-in and last-used times, and whether access has ended.</li>
          <li><strong>Connection and error information:</strong> the page or action requested, timing, internet address, browser details, and security or error logs.</li>
        </ul>
        <p>Wage Tracker does not request access to your contacts, photos, precise device location, microphone, or your device's advertising ID.</p>
      </section>

      <section>
        <h2>How we use information</h2>
        <ul>
          <li>Provide shift, wage, personal spending, goal, history, comparison, report, and optional smart-reminder features.</li>
          <li>Confirm your sign-in and manage signed-in devices.</li>
          <li>Prevent misuse, investigate security problems, and keep the service fair for everyone.</li>
          <li>Find problems and improve speed and reliability.</li>
          <li>Meet legal requirements.</li>
        </ul>
        <p>We do not sell personal information or use it for targeted advertising by other companies.</p>
      </section>

      <section>
        <h2>Companies that help run Wage Tracker</h2>
        <p>
          <strong>Vercel</strong> displays the website and may process normal connection details such as your internet
          address, browser, requested page, and timing. <strong>Render</strong> runs Wage Tracker's online service and
          may process sign-in details, connection information, and operating logs. <strong>Turso</strong> stores account,
          work, personal spending, and signed-in device records. <strong>Resend</strong> processes your email address and
          message content when Wage Tracker sends password-reset instructions or a password-change notice.
          <strong>Google Fonts</strong> may receive normal connection information when the app loads its fonts.
        </p>
        <p>
          These providers use information only to help run Wage Tracker and may operate outside Australia.
          Weekly wage PDFs are created on your device from your current work records. Wage Tracker does not upload a
          separate copy of the finished PDF. Personal spending is not included in those employer-facing wage PDFs.
          Following a link to GitHub or the developer website
          is governed by that destination's own privacy practices.
        </p>
        <p>
          Passwords are protected in a one-way form that cannot be turned back into your readable password. No online
          service can guarantee complete security, but Wage Tracker uses reasonable safeguards for the information it holds.
        </p>
      </section>

      <section>
        <h2>How long we keep information</h2>
        <p>
          Shift records, work expenses, other earnings, and information used for reports are kept for up to five years.
          Older records are then removed automatically. Optional personal spending records and custom spending categories remain
          available across past date ranges until you delete the individual record or delete your account. Account and
          profile information is retained while your account remains active, or as otherwise required for security or legal reasons.
        </p>
        <p>
          You can permanently delete your account from <strong>Settings → Data &amp; account → Delete account</strong>.
          This deletes your account, signed-in devices, shifts, work expenses, other earnings, personal
          expenses, and spending categories. Deletion cannot be undone.
        </p>
      </section>

      <section>
        <h2>Your choices and rights</h2>
        <p>
          You can review and update profile and work information in Settings, log out signed-in devices, change your
          password, and delete your account in the app. Depending on where you live, you may also have rights to
          access, correct, restrict, or object to the processing of your personal information.
        </p>
        <p>
          Smart Shift Reminders are optional and off by default. When enabled, the app looks for a clear weekday
          routine in your completed shifts and schedules reminders for upcoming shifts. Corrected or unusual shifts
          are left out, and you can turn reminders off at any time in Profile &amp; preferences.
        </p>
        <p>To make a privacy request, use the contact options on the <InternalAppLink href="/support">Support page</InternalAppLink>.</p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Wage Tracker is not directed to children under 13, and we do not knowingly collect their personal information.</p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>
          We may update this policy as Wage Tracker or its legal obligations change. The latest version will remain
          available at this URL and will show its effective date above.
        </p>
      </section>
    </PublicPageShell>
  );
}
