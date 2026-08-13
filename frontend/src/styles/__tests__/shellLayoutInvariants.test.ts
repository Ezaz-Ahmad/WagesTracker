// Invariants of the phone shell's layout that the iPhone-PWA viewport fix
// depends on, asserted against the stylesheets themselves. These are the
// things that were repeatedly re-broken while chasing the bug, so they're
// worth a test rather than a comment: the Home-indicator safe area must
// survive, it must be applied exactly once (double-counting it puts the gap
// back by a different route), and the shell must size itself from the
// measured viewport rather than from `dvh` alone.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appCss = readFileSync(resolve(stylesDir, "app.css"), "utf8");
const shellCss = readFileSync(resolve(stylesDir, "shell.css"), "utf8");
const animationsCss = readFileSync(resolve(stylesDir, "animations.css"), "utf8");
const tokensCss = readFileSync(resolve(stylesDir, "tokens.css"), "utf8");
const settingsCss = readFileSync(resolve(stylesDir, "settings.css"), "utf8");
const allCss = [appCss, shellCss, animationsCss, tokensCss, settingsCss].join("\n");

/** Blanks out comments while preserving every character offset, so index
 * arithmetic against the original string still lines up. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => " ".repeat(match.length));
}

/** The `@media` preludes enclosing a given offset, outermost first. Real
 * brace tracking rather than "search backwards for @media", which happily
 * finds an unrelated block that closed long ago. */
function enclosingMediaQueries(css: string, index: number): string[] {
  const source = stripComments(css);
  const stack: (string | null)[] = [];
  for (let i = 0; i < index && i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      const preludeStart = Math.max(source.lastIndexOf("}", i - 1), source.lastIndexOf("{", i - 1)) + 1;
      const prelude = source.slice(preludeStart, i).trim();
      stack.push(prelude.startsWith("@media") ? prelude : null);
    } else if (ch === "}") {
      stack.pop();
    }
  }
  return stack.filter((entry): entry is string => entry !== null);
}

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

describe("no device-specific or hardcoded escape hatches", () => {
  it("anchors the nav with the safe area and flex order, not a magic pixel offset", () => {
    const nav = block(appCss, ".app-bottomnav");
    // A hardcoded bottom offset would make one screenshot look right and
    // break every other iPhone, Android, and landscape.
    expect(nav).not.toMatch(/margin-bottom:\s*\d+px/);
    expect(nav).not.toMatch(/bottom:\s*\d+px/);
    expect(nav).not.toMatch(/transform:\s*translateY/);
  });

  it("contains no device-targeted media queries", () => {
    // e.g. `@media (device-height: 852px)` — an iPhone 15 Pro-only rule.
    expect(allCss).not.toMatch(/@media[^{]*device-height/);
    expect(allCss).not.toMatch(/@media[^{]*device-width/);
    expect(allCss).not.toMatch(/-webkit-device-pixel-ratio[^)]*\)\s*and[^{]*height/);
  });
});

describe("mobile inputs never trigger iOS auto-zoom", () => {
  const MIN_MOBILE_FONT_PX = 16;

  it("sets editable fields to at least 16px below the tablet breakpoint", () => {
    const mobileBlock = tokensCss.slice(tokensCss.indexOf("@media (max-width: 719px)"));
    expect(mobileBlock).toMatch(/\.input[^}]*font-size:\s*(1[6-9]|[2-9]\d)px/s);
  });

  it("does not disable pinch zoom to work around it", () => {
    // Killing user-scalable is the tempting shortcut and an accessibility
    // regression: low-vision users rely on pinch zoom. The 16px rule removes
    // the auto-zoom trigger without taking anything away.
    const indexHtml = readFileSync(resolve(stylesDir, "..", "..", "index.html"), "utf8");
    // Read the meta tag's own content, not the whole file — the surrounding
    // comment legitimately names the things we're asserting aren't set.
    const meta = indexHtml.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
    expect(meta, "no viewport meta tag found").not.toBeNull();
    const content = meta![1];
    expect(content).not.toContain("user-scalable=no");
    expect(content).not.toMatch(/maximum-scale/);
    expect(content).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
  });

  it("has no later rule that shrinks an .input companion class back under 16px on mobile", () => {
    // Derived from the source rather than hardcoded, so a new field with its
    // own class can't quietly reintroduce the auto-zoom trigger.
    const companions = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith(".tsx")) {
          const source = readFileSync(full, "utf8");
          for (const match of source.matchAll(/className=(?:"|\{`)input ([^"`]+)(?:"|`\})/g)) {
            for (const cls of match[1].trim().split(/\s+/)) {
              if (cls && !cls.includes("$") && !cls.includes("{")) companions.add(cls);
            }
          }
        }
      }
    };
    walk(resolve(stylesDir, ".."));
    expect(companions.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const cls of companions) {
      // Any declaration of a sub-16px font-size for this class that is not
      // inside a desktop-only (min-width) media query.
      for (const css of [appCss, settingsCss, tokensCss]) {
        const pattern = new RegExp(`\\.${cls}\\b[^{}]*\\{[^}]*font-size:\\s*(\\d+)px`, "g");
        for (const match of stripComments(css).matchAll(pattern)) {
          const size = Number(match[1]);
          if (size >= MIN_MOBILE_FONT_PX) continue;
          const guarded = enclosingMediaQueries(css, match.index ?? 0).some((q) => q.includes("min-width"));
          if (!guarded) offenders.push(`${cls}: ${size}px`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("reduced motion", () => {
  it("still collapses every transition and animation for prefers-reduced-motion", () => {
    // The shell's fade-in is cosmetic, but it is a transition, so the
    // reduced-motion block must keep covering it.
    expect(animationsCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(animationsCss).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(animationsCss).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it("does not make the shell's height depend on any animation", () => {
    const shell = block(appCss, ".app-shell");
    expect(shell).not.toMatch(/transition:[^;]*height/);
    expect(shell).not.toMatch(/animation:/);
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

describe("design-token integrity", () => {
  // The bug this exists for: `--space-5` was referenced in three places and
  // defined in none. An undefined custom property doesn't fall back to
  // something close — it makes the whole declaration invalid at
  // computed-value time — so `.confirm-modal` and `.wakeup-card` rendered
  // with no padding at all and Home's "Week at a glance" heading with no top
  // margin. Nothing failed, nothing warned, and the CSS still looked
  // perfectly reasonable to read.
  it("defines every custom property the stylesheets reference", () => {
    const source = stripComments(allCss);

    const defined = new Set<string>();
    for (const m of source.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);

    // Properties set from JS via inline styles rather than declared in CSS.
    // Each is written by a specific component; they're listed explicitly so
    // a genuinely undefined token can never hide behind a loose pattern.
    const setInJs = new Set([
      "--app-viewport-height", // lib/viewportHeight.ts
      "--i", // per-item animation stagger index
      "--nav-index", // components/BottomNav.tsx
      "--nav-count", // components/BottomNav.tsx
      "--ring-circumference", // components/GoalRing.tsx
      "--ring-offset-target", // components/GoalRing.tsx
    ]);

    const missing = new Set<string>();
    // `var(--x, fallback)` is fine by construction — the fallback is the
    // definition. Only bare references matter.
    for (const m of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
      const name = m[1];
      if (!defined.has(name) && !setInJs.has(name)) missing.add(name);
    }

    expect([...missing].sort()).toEqual([]);
  });

  it("keeps the spacing scale contiguous, so a missing step is obvious", () => {
    const steps = [...tokensCss.matchAll(/--space-(\d+)\s*:/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 8]);
  });
});

describe("chart sizing", () => {
  // app.css gives the chart an aspect-ratio and height:auto specifically so
  // it scales uniformly at every container width. A later rule that sets a
  // fixed height against its 100% width re-introduces the stretched line and
  // elliptical dots that fix removed — which is exactly what a desktop
  // override in shell.css was doing.
  it("never re-imposes a fixed height on the aspect-ratio chart", () => {
    expect(appCss).toMatch(/\.chart-svg\s*\{[^}]*aspect-ratio/);
    // Scanned against comment-stripped source: shell.css mentions the
    // removed `.chart-svg { height: 220px }` rule inside a comment
    // explaining why it is gone, and matching that would fail forever.
    // The value is captured and compared rather than excluded with a
    // negative lookahead — `\s*(?!auto)` happily backtracks to a zero-width
    // match and "succeeds" on `height: auto`.
    const offenders: string[] = [];
    for (const m of stripComments(allCss).matchAll(/\.chart-svg[^{]*\{([^}]*)\}/g)) {
      for (const decl of m[1].matchAll(/(?:^|[;{\s])height\s*:([^;}]+)/g)) {
        const value = decl[1].trim();
        if (value !== "auto") offenders.push(`height: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("touch targets", () => {
  // WCAG 2.5.5. Each of these is a small glyph inside a deliberately larger
  // hit area; the risk is someone later "tidying" the box down to the glyph.
  const required: [string, string][] = [
    [".banner-dismiss", tokensCss],
    [".sessions-drawer-icon-btn", settingsCss],
    [".btn-icon", tokensCss],
  ];

  for (const [selector, css] of required) {
    it(`${selector} keeps a 44px hit area`, () => {
      const body = block(css, selector);
      expect(body).toMatch(/width:\s*44px/);
      expect(body).toMatch(/height:\s*44px/);
    });
  }
});

describe("looping animation restraint", () => {
  // The refresh glyph spins only while a request is genuinely in flight, and
  // must stop entirely under reduced motion — the button's own "Refreshing…"
  // label carries the state, so nothing is lost by stopping it.
  it("stops the refresh spinner under prefers-reduced-motion", () => {
    expect(settingsCss).toMatch(/\.refresh-glyph\.is-spinning\s*\{[^}]*animation:\s*refresh-glyph-spin/);
    // settings.css has more than one reduced-motion block (the drawer has
    // its own), so this looks for the rule inside *any* of them rather than
    // assuming which one.
    const source = stripComments(settingsCss);
    const stopped = [...source.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].some((m) =>
      /\.refresh-glyph\.is-spinning\s*\{\s*animation:\s*none/.test(m[1])
    );
    expect(stopped).toBe(true);
  });
});
