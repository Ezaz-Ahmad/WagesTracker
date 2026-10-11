import { InternalAppLink } from "../components/AppLink";
import { ChevronRightIcon, HelpCircleIcon, LockIcon } from "../components/icons";

export function AboutSettings() {
  return (
    <nav className="settings-about-links card" aria-label="Privacy and support">
      <InternalAppLink className="settings-about-link" href="/privacy">
        <span className="settings-about-icon" aria-hidden="true"><LockIcon size={20} /></span>
        <span className="settings-about-text">
          <span className="settings-about-label">Privacy Policy</span>
          <span className="settings-about-description">How your data is collected and protected.</span>
        </span>
        <span className="settings-about-chevron" aria-hidden="true"><ChevronRightIcon size={18} /></span>
      </InternalAppLink>
      <InternalAppLink className="settings-about-link" href="/support">
        <span className="settings-about-icon" aria-hidden="true"><HelpCircleIcon size={20} /></span>
        <span className="settings-about-text">
          <span className="settings-about-label">Support</span>
          <span className="settings-about-description">Get help or share feedback.</span>
        </span>
        <span className="settings-about-chevron" aria-hidden="true"><ChevronRightIcon size={18} /></span>
      </InternalAppLink>
    </nav>
  );
}
