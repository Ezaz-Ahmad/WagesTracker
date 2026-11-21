import { useLayoutEffect, useRef, type ReactNode } from "react";
import { normaliseAppPath, returnToWageTracker } from "../lib/appNavigation";
import { InternalAppLink } from "./AppLink";
import { Logo } from "./Logo";

type PublicPageShellProps = {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  standalone?: boolean;
  sections?: readonly { id: string; label: string }[];
};

export function PublicPageShell({ eyebrow, title, summary, children, standalone = false, sections = [] }: PublicPageShellProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const path = normaliseAppPath();
  const contents = sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.label}</a>);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="public-page-shell public-page-transition">
      <header className="public-page-chrome"><div className="public-page-header">
        {standalone ? <a className="public-page-brand" href="/" aria-label="Wages Tracker home">
          <Logo size={25} />
          <span>Wages Tracker</span>
        </a> : <button className="public-page-brand" type="button" onClick={returnToWageTracker} aria-label="Wages Tracker home">
          <Logo size={25} />
          <span>Wages Tracker</span>
        </button>}
        <nav className="public-page-nav" aria-label="Legal and support">
          <InternalAppLink href="/privacy" aria-current={path === "/privacy" ? "page" : undefined}>Privacy</InternalAppLink>
          <InternalAppLink href="/support" aria-current={path === "/support" ? "page" : undefined}>Support</InternalAppLink>
        </nav>
        {standalone ? <a className="public-page-return" href="/"><span aria-hidden="true">←</span> Return to Wages Tracker</a> : <button type="button" className="public-page-return" onClick={returnToWageTracker}><span aria-hidden="true">←</span> Return to Wages Tracker</button>}
      </div></header>

      <main className="public-page-main">
        <div className="public-page-hero">
          <p className="public-page-eyebrow">{eyebrow}</p>
          <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
          <p className="public-page-summary">{summary}</p>
        </div>
        <div className={`public-page-body${sections.length ? " has-contents" : ""}`}>
          {sections.length > 0 && <>
            <aside className="public-page-contents-desktop"><nav aria-label="On this page"><span className="public-page-contents-label">On this page</span>{contents}</nav></aside>
            <details className="public-page-contents-mobile"><summary>On this page</summary><nav aria-label="Page sections">{contents}</nav></details>
          </>}
          <article className="public-page-card">{children}</article>
        </div>
      </main>

      <footer className="public-page-footer">
        <span>© {new Date().getFullYear()} Ezaz Ahmad</span>
        <span aria-hidden="true">·</span><span>Wages Tracker</span>
      </footer>
    </div>
  );
}
