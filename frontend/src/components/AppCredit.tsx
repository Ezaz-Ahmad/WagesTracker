import { GithubIcon, GlobeIcon } from "./icons";

/** Shared creator credit — shown on the auth screen and in Settings. */
export function AppCredit() {
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
    </div>
  );
}
