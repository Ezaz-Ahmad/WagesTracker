import { GithubIcon, GlobeIcon } from "./icons";
import { VERSION_LABEL } from "../lib/appVersion";

/** Shared creator credit — shown on the auth screen and in Settings.
 * `showVersion` additionally renders the build version underneath, which is
 * only turned on in Settings — it's useful "which build am I on" info, not
 * something the marketing-flavored auth screen needs cluttering it up. */
export function AppCredit({ showVersion = false }: { showVersion?: boolean }) {
  return (
    <div className="app-credit">
      <span className="app-credit-name">Built by Ezaz Ahmad</span>
      <span className="app-credit-links">
        <a className="app-credit-link" href="https://github.com/Ezaz-Ahmad" target="_blank" rel="noopener noreferrer">
          <GithubIcon size={13} />
          GitHub
        </a>
        <a className="app-credit-link" href="https://ezazahmad.com" target="_blank" rel="noopener noreferrer">
          <GlobeIcon size={13} />
          Portfolio
        </a>
      </span>
      {showVersion && <span className="app-credit-version">{VERSION_LABEL}</span>}
    </div>
  );
}
