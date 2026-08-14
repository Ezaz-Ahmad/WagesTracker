import { PublicPageShell } from "../components/PublicPageShell";

const REPOSITORY_URL = "https://github.com/Ezaz-Ahmad/WagesTracker";
const ISSUE_URL = `${REPOSITORY_URL}/issues/new`;
const CONTACT_URL = "https://www.ezazahmad.com/";

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
          For the fastest response, submit a support request with the device you use, the app version shown in
          Settings, what you expected to happen, and what happened instead.
        </p>
        <div className="support-actions">
          <a className="btn btn-primary" href={ISSUE_URL} target="_blank" rel="noopener noreferrer">
            Submit a support request
          </a>
          <a className="btn btn-secondary" href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
            Contact the developer
          </a>
        </div>
        <p className="public-page-fine-print">
          Support is provided in English. Never include your password, authentication token, or complete financial
          records in a public request.
        </p>
      </section>

      <section>
        <h2>Common questions</h2>
        <h3>I cannot log in</h3>
        <p>
          Check that your email address is correct and that your internet connection is working. If the service is
          waking after a period of inactivity, leave the app open and use Retry when prompted.
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
          If you believe you found a security or privacy issue, contact the developer before publishing sensitive
          details. Include a clear description and safe reproduction steps, but do not access another person’s data
          or include secrets in your report.
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
