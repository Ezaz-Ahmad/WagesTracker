import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import {
  isPublicAppPath,
  navigateWithinApp,
  normaliseAppPath,
  rememberAppReturnFocus,
} from "../lib/appNavigation";

type InternalAppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

export function InternalAppLink({ href, onClick, children, ...props }: InternalAppLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return;
    event.preventDefault();
    if (!isPublicAppPath(normaliseAppPath())) rememberAppReturnFocus(event.currentTarget);
    navigateWithinApp(href);
  };

  return <a {...props} href={href} onClick={handleClick}>{children}</a>;
}

type ExternalAppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  description: string;
};

export function ExternalAppLink({ children, description, "aria-label": ariaLabel, ...props }: ExternalAppLinkProps) {
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel ?? `${description} (opens in a new tab)`}
    >
      {children}
      <span className="external-link-mark" aria-hidden="true">↗</span>
    </a>
  );
}
