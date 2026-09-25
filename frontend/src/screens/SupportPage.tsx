import { PublicPageShell } from "../components/PublicPageShell";
import { ExternalAppLink, InternalAppLink } from "../components/AppLink";

const REPOSITORY_URL = "https://github.com/Ezaz-Ahmad/WagesTracker";
const ISSUE_URL = `${REPOSITORY_URL}/issues/new`;
const SUPPORT_EMAIL = "ezazahmadshanto@gmail.com";
const CONTACT_URL = "https://www.ezazahmad.com/#contact";

export function SupportPage() {
  return (
    <PublicPageShell
      eyebrow="Help centre"
      title="Wage Tracker Support"
      summary="Get help with your account, shifts, wage totals, reports, app setup, or any other problem."
    >
      <section className="support-callout" aria-labelledby="support-contact-title">
        <h2 id="support-contact-title">Contact support</h2>
        <p>
          For private account, wage, privacy, or security assistance, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or use the developer's private contact form.
          Include the device you use, the app version shown in Settings, what you expected, and what happened.
        </p>
        <div className="support-actions">
          <ExternalAppLink className="btn btn-primary" href={CONTACT_URL} description="Private contact form">
            Open private contact form
          </ExternalAppLink>
          <ExternalAppLink className="btn btn-secondary" href={ISSUE_URL} description="Public issue form">
            Report a non-sensitive bug
          </ExternalAppLink>
        </div>
        <p className="public-page-fine-print">
          GitHub issues are public. Never include personal information, account details, wage or shift records,
          sign-in details, privacy requests, security problems, passwords, reset links, or other secrets in a GitHub
          issue. Support is provided in English.
        </p>
      </section>

      <section>
        <h2>Common questions</h2>
        <h3>I cannot log in</h3>
        <p>
          Check that your email address is correct and that your internet connection is working. If the app is getting
          ready after a period of inactivity, leave it open and choose Try again when prompted. If you have forgotten
          your password, choose <strong>Forgot password?</strong> on the login screen. For privacy, you'll see the same
          message even if no account uses that email. Check the inbox and spam folder for the address you entered.
        </p>

        <h3>My active shift is still counting</h3>
        <p>
          Logging out or closing the app does not end a shift. Sign back in and clock out from the Entry screen. You
          can correct completed entries from History when necessary.
        </p>

        <h3>A wage total looks incorrect</h3>
        <p>
          Review your hourly rate, shift times, expenses, and other earnings. Wage Tracker estimates totals from the
          details you enter. It does not calculate tax, superannuation, penalty rates, or payroll entitlements unless
          you add them to your entries.
        </p>

        <h3>How do I export a report?</h3>
        <p>Open Report or History, select the relevant week, and use the PDF download option.</p>

        <h3>How do I delete my account?</h3>
        <p>
          Open <strong>Settings → Data &amp; account → Delete account</strong>, enter your password, and confirm. Account
          deletion is permanent and cannot be undone.
        </p>
      </section>

      <section>
        <h2>Security and privacy reports</h2>
        <p>
          Do not report security vulnerabilities or privacy matters through GitHub issues. Use the private developer
          contact options above before publishing any details. Explain the steps that showed the problem, but do not access
          another person's data or include passwords, sign-in links, codes, or other secrets.
        </p>
        <p>For information about data handling, read the <InternalAppLink href="/privacy">Privacy Policy</InternalAppLink>.</p>
      </section>

      <section>
        <h2>Service status and updates</h2>
        <p>
          Release notes, known issues, and development updates are available on the public{" "}
          <ExternalAppLink href={REPOSITORY_URL} description="Wage Tracker project page">Wage Tracker project page</ExternalAppLink>.
        </p>
      </section>
    </PublicPageShell>
  );
}
