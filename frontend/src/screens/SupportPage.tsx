import { PublicPageShell } from "../components/PublicPageShell";

const REPOSITORY_URL = "https://github.com/Ezaz-Ahmad/WagesTracker";
const ISSUE_URL = `${REPOSITORY_URL}/issues/new`;
const SUPPORT_EMAIL = "ezazahmadshanto@gmail.com";
const CONTACT_URL = "https://www.ezazahmad.com/#contact";

export function SupportPage() {
  return (
    <PublicPageShell
      eyebrow="Help centre"
      title="Wage Tracker Support"
      summary="Get help with your account, shifts, wage calculations, reports, installation, or a technical problem."
    >
      <section className="support-callout" aria-labelledby="support-contact-title">
        <h2 id="support-contact-title">Contact support</h2>
        <p>
          For private account, wage, privacy, or security assistance, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or use the developer's private contact form.
          Include the device you use, the app version shown in Settings, what you expected, and what happened.
        </p>
        <div className="support-actions">
          <a className="btn btn-primary" href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
            Open private contact form
          </a>
          <a className="btn btn-secondary" href={ISSUE_URL} target="_blank" rel="noopener noreferrer">
            Report a non-sensitive bug
          </a>
        </div>
        <p className="public-page-fine-print">
          GitHub issues are public. Never include personal information, account details, wage or shift records,
          authentication information, privacy requests, security vulnerabilities, passwords, or tokens in a GitHub
          issue. Support is provided in English.
        </p>
      </section>

      <section>
        <h2>Common questions</h2>
        <h3>I cannot log in</h3>
        <p>
          Check that your email address is correct and that your internet connection is working. If the service is
          waking after a period of inactivity, leave the app open and use Retry when prompted. If you have forgotten
          your password, choose <strong>Forgot password?</strong> on the login screen. For privacy, the confirmation is
          the same whether or not an account exists; check the inbox and spam folder for the address you entered.
        </p>

        <h3>My active shift is still counting</h3>
        <p>
          Logging out or closing the app does not end a shift. Sign back in and clock out from the Entry screen. You
          can correct completed entries from History when necessary.
        </p>

        <h3>A wage total looks incorrect</h3>
        <p>
          Review your hourly rate, shift times, expenses, and additional earnings. Wage Tracker provides estimates
          based on the details you enter and does not calculate tax, superannuation, penalty rates, or payroll
          entitlements unless they are explicitly represented in your entries.
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
          contact options above before publishing any details. Include safe reproduction steps, but do not access
          another person's data or include credentials, tokens, or other secrets.
        </p>
        <p>For information about data handling, read the <a href="/privacy">Privacy Policy</a>.</p>
      </section>

      <section>
        <h2>Service status and updates</h2>
        <p>
          Release notes, known issues, and source-code updates are available in the public{" "}
          <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">Wage Tracker repository</a>.
        </p>
      </section>
    </PublicPageShell>
  );
}
