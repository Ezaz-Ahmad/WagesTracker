import { PublicPageShell } from "../components/PublicPageShell";
import { ExternalAppLink, InternalAppLink } from "../components/AppLink";

const REPOSITORY_URL = "https://github.com/Ezaz-Ahmad/WagesTracker";
const ISSUE_URL = `${REPOSITORY_URL}/issues/new`;
const SUPPORT_EMAIL = "ezazahmadshanto@gmail.com";
const CONTACT_URL = "https://www.ezazahmad.com/";

export function SupportPage() {
  return (
    <PublicPageShell
      eyebrow="Help centre"
      title="Wages Tracker Support"
      summary="Get help with your account, shifts, wage totals, reports, app setup, or any other problem."
      sections={[{ id: "contact", label: "Contact support" }, { id: "questions", label: "Common questions" }, { id: "security", label: "Security & privacy" }, { id: "updates", label: "Service updates" }]}
    >
      <section id="contact" className="support-callout" aria-labelledby="support-contact-title">
        <span className="support-section-kicker">Personal help</span>
        <h2 id="support-contact-title">Contact support</h2>
        <p>
          For private account, wage, privacy, or security assistance, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or use “Contact with me” at the bottom of the developer's website.
          Include the device you use, the app version shown in Settings, what you expected, and what happened.
        </p>
        <div className="support-actions">
          <a className="btn btn-primary" href={`mailto:${SUPPORT_EMAIL}?subject=Wages%20Tracker%20support`}>Email support</a>
          <ExternalAppLink className="btn btn-secondary" href={CONTACT_URL} description="Developer website with contact options">
            Visit developer website
          </ExternalAppLink>
        </div>
        <div className="support-checklist"><strong>Help us understand the issue</strong><ul><li>Your device and app version from Settings → About.</li><li>What you were trying to do and what happened.</li><li>A screenshot with private details hidden, if helpful.</li></ul></div>
      </section>

      <section className="support-bug-report" aria-labelledby="bug-report-title">
        <h2 id="bug-report-title">Report a general app issue</h2>
        <p>For a bug that does not involve private information, you can use the public issue tracker.</p>
        <ExternalAppLink className="btn btn-secondary" href={ISSUE_URL} description="Public issue form">Report a non-sensitive bug</ExternalAppLink>
        <p className="public-page-fine-print">
          GitHub issues are public. Never include personal information, account details, wage or shift records,
          sign-in details, privacy requests, security problems, passwords, reset links, or other secrets in a GitHub
          issue. Support is provided in English.
        </p>
      </section>

      <section id="questions" className="support-questions">
        <h2>Common questions</h2>
        <p className="support-section-intro">Start with the topic that matches what you need.</p>
        <details className="support-faq"><summary>I cannot log in</summary><div>
        <p>
          Check that your email address is correct and that your internet connection is working. If the app is getting
          ready after a period of inactivity, leave it open and choose Try again when prompted. If you have forgotten
          your password, choose <strong>Forgot password?</strong> on the login screen. For privacy, you'll see the same
          message even if no account uses that email. Check the inbox and spam folder for the address you entered.
        </p>
        </div></details>

        <details className="support-faq"><summary>My active shift is still counting</summary><div>
        <p>
          Logging out or closing the app does not end a shift. Sign back in and clock out from the Entry screen. You
          can correct completed entries from History when necessary.
        </p>
        </div></details>

        <details className="support-faq"><summary>A wage total looks incorrect</summary><div>
        <p>Choose the correct job, then review its rates in <strong>Settings → Your jobs → Work &amp; pay</strong>. Each location can have its own rate and effective date. Saved shifts keep their recorded rate when the pay schedule changes; tap the rate in Entry or edit the shift in History to review a correction.</p>
        <p>
          Review your hourly rate, shift times, expenses, and other earnings. Wages Tracker estimates totals from the
          details you enter. It does not calculate tax, superannuation, penalty rates, or payroll entitlements unless
          you add them to your entries.
        </p>
        </div></details>

        <details className="support-faq"><summary>How do I export a report?</summary><div>
        <p>Open Report or History, select the relevant week, and use the PDF option. Choose one employer's report or a personal summary across jobs. The PDF uses each shift's recorded hourly rate and lists fuel allowances and extras separately. On iPhone, use the share sheet to save or send the PDF.</p>
        </div></details>

        <details className="support-faq"><summary>How do I delete a job?</summary><div><p>Open <strong>Settings → Your jobs → Delete job</strong>. Review the record counts and impact, then type the job name to confirm. This permanently deletes the job's shifts, locations, pay history, allowances, extras and linked spending. Other jobs and unlinked spending stay available. End any running shift first.</p></div></details>

        <details className="support-faq"><summary>How do I delete my account?</summary><div>
        <p>
          Open <strong>Settings → Data &amp; account → Delete account</strong>, enter your password, and confirm. Account
          deletion is permanent and cannot be undone.
        </p>
        </div></details>
      </section>

      <section id="security">
        <h2>Security and privacy reports</h2>
        <p>
          Do not report security vulnerabilities or privacy matters through GitHub issues. Use the private developer
          contact options above before publishing any details. Explain the steps that showed the problem, but do not access
          another person's data or include passwords, sign-in links, codes, or other secrets.
        </p>
        <p>For information about data handling, read the <InternalAppLink href="/privacy">Privacy Policy</InternalAppLink>.</p>
      </section>

      <section id="updates">
        <h2>Service status and updates</h2>
        <p>
          Release notes, known issues, and development updates are available on the public{" "}
          <ExternalAppLink href={REPOSITORY_URL} description="Wages Tracker project page">Wages Tracker project page</ExternalAppLink>.
        </p>
      </section>
    </PublicPageShell>
  );
}
