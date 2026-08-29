import { GithubIcon, GlobeIcon } from "./icons";
import { APP_VERSION } from "../lib/appVersion";
import { ExternalAppLink, InternalAppLink } from "./AppLink";

/** The developer's own links, defined once. AppCredit (Settings) and this
 * footer both render them; two copies would eventually disagree about a URL. */
export const DEVELOPER_LINKS = [
  { href: "https://github.com/Ezaz-Ahmad", label: "GitHub", Icon: GithubIcon, description: "Ezaz Ahmad's GitHub profile" },
  { href: "https://ezazahmad.com", label: "Portfolio", Icon: GlobeIcon, description: "Ezaz Ahmad's portfolio" },
] as const;

/**
 * Attribution and build version, at the foot of the authentication card.
 *
 * It used to sit between the login/signup toggle and the form — above the
 * fields, above the error banner, in the middle of the one thing the screen
 * exists to do. That put a portfolio link in the visual path of someone
 * trying to sign in, and left a failed-login message competing with it for
 * attention.
 *
 * Here it is after the form, behind a hairline rule, at a smaller size and
 * lower contrast. Deliberately in normal document flow rather than pinned:
 * absolute positioning would overlap the form on a short screen, and on a
 * phone with the keyboard open there is very little screen left. Flowing
 * means the worst case is that it scrolls out of view, which is the correct
 * behaviour for a footer.
 *
 * One component for both modes. Login and signup share the card, so a footer
 * per form would be two things to keep in step for no benefit.
 */
export function AuthFooter() {
  return (
    <footer className="auth-footer">
      <p className="auth-footer-name">Built by Ezaz Ahmad</p>
      <p className="auth-footer-links">
        <InternalAppLink className="auth-footer-link" href="/privacy">Privacy</InternalAppLink>
        <InternalAppLink className="auth-footer-link" href="/support">Support</InternalAppLink>
        {DEVELOPER_LINKS.map(({ href, label, Icon, description }) => (
          <ExternalAppLink
            key={href}
            className="auth-footer-link"
            href={href}
            description={description}
          >
            <Icon size={13} />
            {label}
          </ExternalAppLink>
        ))}
      </p>
      {/* The real build version, from package.json via vite's define (see
          lib/appVersion.ts) — never a second number maintained by hand here,
          which would drift from the release the moment either changed. */}
      <p className="auth-footer-version">Version {APP_VERSION}</p>
    </footer>
  );
}
