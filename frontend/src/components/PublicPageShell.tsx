import { useLayoutEffect, useRef, type ReactNode } from "react";
import { returnToWageTracker } from "../lib/appNavigation";
import { InternalAppLink } from "./AppLink";
import { Logo } from "./Logo";

type PublicPageShellProps = {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  standalone?: boolean;
};

export function PublicPageShell({ eyebrow, title, summary, children, standalone = false }: PublicPageShellProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="public-page-shell public-page-transition">
      <header className="public-page-header">
        {standalone ? <a className="public-page-brand" href="/" aria-label="Wage Tracker home">
          <Logo size={25} />
          <span>Wage Tracker</span>
        </a> : <button className="public-page-brand" type="button" onClick={returnToWageTracker} aria-label="Wage Tracker home">
          <Logo size={25} />
          <span>Wage Tracker</span>
        </button>}
        <nav className="public-page-nav" aria-label="Legal and support">
          <InternalAppLink href="/privacy">Privacy</InternalAppLink>
          <InternalAppLink href="/support">Support</InternalAppLink>
        </nav>
      </header>

      <main className="public-page-main">
        <div className="public-page-hero">
          <p className="public-page-eyebrow">{eyebrow}</p>
          <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
          <p className="public-page-summary">{summary}</p>
        </div>
        <article className="public-page-card">{children}</article>
      </main>

      <footer className="public-page-footer">
        <span>© {new Date().getFullYear()} Ezaz Ahmad</span>
        <span aria-hidden="true">·</span>
        {standalone
          ? <a className="public-page-return" href="/">Return to Wage Tracker</a>
          : <button type="button" className="public-page-return" onClick={returnToWageTracker}>Return to Wage Tracker</button>}
      </footer>
    </div>
  );
}
