import { VERSION_LABEL } from "../lib/appVersion";
import { DEVELOPER_LINKS } from "./AuthFooter";
import { ExternalAppLink } from "./AppLink";

/** Creator credit for the Settings overview. Developer URLs are shared with
 * AuthFooter; the optional build label stays tied to the current release. */
export function AppCredit({ showVersion = false }: { showVersion?: boolean }) {
  // Runtime date, not a build constant: the app's minute clock also re-renders
  // Settings across New Year, including an already-installed native build.
  const copyrightYear = new Date().getFullYear();

  return (
    <div className="app-credit">
      <span className="app-credit-name">Built by <strong>Ezaz Ahmad</strong></span>
      <nav className="app-credit-links" aria-label="Developer links">
        {/* Shared with the auth footer so the two can't drift apart on a URL. */}
        {DEVELOPER_LINKS.map(({ href, label, Icon, description }) => (
          <ExternalAppLink
            key={href}
            className="app-credit-link"
            href={href}
            description={description}
          >
            <Icon size={13} />
            {label}
          </ExternalAppLink>
        ))}
      </nav>
      <div className="app-credit-meta">
        {showVersion && <span className="app-credit-version">{VERSION_LABEL}</span>}
        <span className="app-credit-copyright">© {copyrightYear} Ezaz Ahmad. All rights reserved.</span>
      </div>
    </div>
  );
}
