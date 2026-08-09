// Invariants of the phone shell's layout that the iPhone-PWA viewport fix
// depends on, asserted against the stylesheets themselves. These are the
// things that were repeatedly re-broken while chasing the bug, so they're
// worth a test rather than a comment: the Home-indicator safe area must
// survive, it must be applied exactly once (double-counting it puts the gap
// back by a different route), and the shell must size itself from the
// measured viewport rather than from `dvh` alone.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appCss = readFileSync(resolve(stylesDir, "app.css"), "utf8");
const shellCss = readFileSync(resolve(stylesDir, "shell.css"), "utf8");

/** Body of a top-level rule, e.g. block(appCss, ".app-bottomnav"). */
function block(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `expected to find a \`${selector}\` rule`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("app shell height", () => {
  it("sizes itself from the measured viewport height, with dvh only as a fallback", () => {
    expect(appCss).toContain("height: var(--app-viewport-height, 100dvh)");
  });

  it("keeps a plain vh fallback for browsers without dvh", () => {
    expect(block(appCss, ".app-shell")).toContain("height: 100vh");
  });

  it("guards the custom-property height behind an @supports check", () => {
    // Without this, a browser that has neither `dvh` nor the variable set
    // would compute the shell's height as `auto`.
    expect(appCss).toMatch(/@supports \(height: 100dvh\) \{\s*\.app-shell \{ height: var\(--app-viewport-height/);
  });

  it("keeps the shell a fixed-height, non-scrolling container", () => {
    expect(block(appCss, ".app-shell")).toContain("overflow: hidden");
  });

  it("keeps .app-main as the only scrolling area", () => {
    const main = block(appCss, ".app-main");
    expect(main).toContain("flex: 1");
    expect(main).toContain("overflow-y: auto");
    expect(main).toContain("min-height: 0");
  });

  it("keeps the bottom nav a non-scrolling sibling rather than fixed or sticky", () => {
    const nav = block(appCss, ".app-bottomnav");
    expect(nav).toContain("flex: none");
    expect(nav).not.toMatch(/position:\s*(fixed|sticky)/);
  });
});

describe("home-indicator safe area", () => {
  it("still spaces the bottom nav off the Home indicator", () => {
    expect(block(appCss, ".app-bottomnav")).toContain("max(var(--space-2), env(safe-area-inset-bottom))");
  });

  it("applies the bottom inset exactly once in the phone shell chain", () => {
    // The shell's height is the *full* visual viewport (viewport-fit=cover),
    // so the inset belongs to the nav's own margin and nowhere else —
    // adding it to .app-main's padding or the shell's height as well would
    // reserve the Home indicator's space twice.
    const chain = [".app-shell", ".app-frame", ".app-main", ".app-bottomnav"];
    const uses = chain.filter((selector) => block(appCss, selector).includes("safe-area-inset-bottom"));
    expect(uses).toEqual([".app-bottomnav"]);
  });
});

describe("installed-PWA background continuity", () => {
  it("matches the root surfaces to the app background on an installed phone PWA", () => {
    expect(shellCss).toMatch(/@media \(display-mode: standalone\) and \(max-width: 719px\)/);
    const start = shellCss.indexOf("@media (display-mode: standalone)");
    const rule = shellCss.slice(start, shellCss.indexOf("}", shellCss.indexOf("{", shellCss.indexOf("{", start) + 1)));
    expect(rule).toContain("html");
    expect(rule).toContain("body");
    expect(rule).toContain("#root");
    expect(rule).toContain("background: var(--color-bg)");
  });
});
