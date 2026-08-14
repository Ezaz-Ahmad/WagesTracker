import { PublicPageShell } from "../components/PublicPageShell";

const LAST_UPDATED = "14 August 2026";

export function PrivacyPolicyPage() {
  return (
    <PublicPageShell
      eyebrow="Privacy"
      title="Privacy Policy"
      summary="Wage Tracker is designed to collect only the information needed to provide your private wage-tracking workspace and keep it secure."
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
          <li><strong>Account information:</strong> your name, email address, and securely hashed password.</li>
          <li><strong>Work profile:</strong> home and work addresses, workplace names, pay rate, week-start preference, and weekly goals.</li>
          <li><strong>Work records:</strong> shift dates and times, work locations, expenses, additional earnings, and report data.</li>
          <li><strong>Security information:</strong> session identifiers, device or browser description, installation identifier, IP address, login and activity times, and session expiry or revocation status.</li>
          <li><strong>Technical information:</strong> information needed to diagnose errors, protect the service, and maintain reliable operation.</li>
        </ul>
        <p>Wage Tracker does not request access to your contacts, photos, precise device location, microphone, or advertising identifier.</p>
      </section>

      <section>
        <h2>How we use information</h2>
        <ul>
          <li>Provide shift, wage, expense, goal, history, and report features.</li>
          <li>Authenticate your account and manage active sessions.</li>
          <li>Prevent abuse, investigate security events, and enforce service limits.</li>
          <li>Maintain, troubleshoot, and improve performance and reliability.</li>
          <li>Comply with applicable legal obligations.</li>
        </ul>
        <p>We do not sell personal information or use it for third-party behavioural advertising.</p>
      </section>

      <section>
        <h2>Storage and service providers</h2>
        <p>
          Information is transmitted using HTTPS and stored using hosting, database, and infrastructure providers
          that process it on our behalf. Those providers may operate systems outside Australia. We limit provider
          access to what is necessary to deliver and protect the service.
        </p>
        <p>
          Passwords are stored as one-way cryptographic hashes rather than readable passwords. No internet service
          can guarantee absolute security, but we use reasonable technical and organisational safeguards appropriate
          to the information handled by Wage Tracker.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          Shift, expense, additional-earning, and report-related records are retained for up to five years and older
          records are automatically removed. Account and profile information is retained while your account remains
          active, or as otherwise required for security or legal reasons.
        </p>
        <p>
          You can permanently delete your account from <strong>Settings → Data &amp; account → Delete account</strong>.
          This deletes your account, sessions, shifts, expenses, and additional-earning records from the active
          service. Deletion cannot be undone. Limited copies may remain temporarily in encrypted backups until those
          backups are rotated.
        </p>
      </section>

      <section>
        <h2>Your choices and rights</h2>
        <p>
          You can review and update profile and work information in Settings, revoke active sessions, change your
          password, and delete your account in the app. Depending on where you live, you may also have rights to
          access, correct, restrict, or object to the processing of your personal information.
        </p>
        <p>To make a privacy request, use the contact options on the <a href="/support">Support page</a>.</p>
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
