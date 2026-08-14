import type { ReactNode } from "react";
import { Logo } from "./Logo";

type PublicPageShellProps = {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
};

export function PublicPageShell({ eyebrow, title, summary, children }: PublicPageShellProps) {
  return (
    <div className="public-page-shell">
      <header className="public-page-header">
        <a className="public-page-brand" href="/" aria-label="Wage Tracker home">
          <Logo size={25} />
          <span>Wage Tracker</span>
        </a>
        <nav className="public-page-nav" aria-label="Legal and support">
          <a href="/privacy">Privacy</a>
          <a href="/support">Support</a>
        </nav>
      </header>

      <main className="public-page-main">
        <div className="public-page-hero">
          <p className="public-page-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="public-page-summary">{summary}</p>
        </div>
        <article className="public-page-card">{children}</article>
      </main>

      <footer className="public-page-footer">
        <span>© {new Date().getFullYear()} Ezaz Ahmad</span>
        <span aria-hidden="true">·</span>
        <a href="/">Return to Wage Tracker</a>
      </footer>
    </div>
  );
}
