import { VERSION_LABEL } from "../lib/appVersion";
import { DEVELOPER_LINKS } from "./AuthFooter";
import { ExternalAppLink } from "./AppLink";

/** Shared creator credit — shown on the auth screen and in Settings.
 * `showVersion` additionally renders the full build label (version, commit
 * hash and build date) underneath, which is only turned on in Settings —
 * that level of detail is diagnostic. The auth screen shows just the version
 * number, in its own footer (see AuthFooter). */
export function AppCredit({ showVersion = false }: { showVersion?: boolean }) {
  return (
    <div className="app-credit">
      <span className="app-credit-name">Built by Ezaz Ahmad</span>
      <span className="app-credit-links">
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
      </span>
      {showVersion && <span className="app-credit-version">{VERSION_LABEL}</span>}
    </div>
  );
}
