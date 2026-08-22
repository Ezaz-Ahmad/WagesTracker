import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spendingCss = readFileSync(resolve(stylesDir, "spending.css"), "utf8");
const appCss = readFileSync(resolve(stylesDir, "app.css"), "utf8");
const animationsCss = readFileSync(resolve(stylesDir, "animations.css"), "utf8");

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `expected ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("Spending touch-stability layout", () => {
  it("uses the measured viewport variable for the expense sheet and never the obsolete app-height variable", () => {
    expect(spendingCss).toContain("var(--app-viewport-height, 100dvh)");
    expect(spendingCss).not.toContain("--app-height");
  });

  it("keeps the sheet shell fixed while only its body scrolls", () => {
    expect(block(spendingCss, ".spending-dialog")).toContain("overflow: hidden");
    const body = block(spendingCss, ".spending-dialog-body");
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("overscroll-behavior: contain");
    expect(block(spendingCss, ".spending-dialog-actions")).not.toMatch(/position:\s*sticky/);
  });

  it("keeps category selection geometry constant", () => {
    expect(block(spendingCss, ".spending-category-picker label")).toContain("border: 2px solid transparent");
    expect(block(spendingCss, ".spending-category-picker label.is-selected")).toContain("border-color:");
    expect(block(spendingCss, ".spending-category-picker label.is-selected")).not.toMatch(/border(?:-width)?:\s*(?!var)/);
    expect(block(spendingCss, ".category-icon-options label")).toContain("border: 2px solid transparent");
    expect(block(spendingCss, ".category-icon-options label.is-selected")).not.toMatch(/border(?:-width)?:\s*(?!var)/);
  });

  it("does not give the swipe track a transform or permanent compositor layer", () => {
    const track = block(appCss, ".swipe-track");
    expect(track).not.toMatch(/transform/);
    expect(track).not.toMatch(/will-change/);
  });

  it("reserves geometry for initial skeletons and background refresh labels", () => {
    expect(spendingCss).toContain(".spending-summary-skeleton");
    expect(spendingCss).toContain(".home-spending-skeleton-legend");
    expect(block(spendingCss, ".spending-cache-status")).toContain("min-height:");
    expect(spendingCss).toMatch(/\.home-spending-updating,\s*\.spending-refreshing\s*\{[^}]*min-width:/);
  });

  it("keeps tab motion small and limited to transform plus opacity", () => {
    expect(animationsCss).toContain("translateX(10px)");
    expect(animationsCss).toContain("translateX(-10px)");
    for (const name of ["screen-in", "screen-in-fwd", "screen-in-back"]) {
      const start = animationsCss.indexOf(`@keyframes ${name}`);
      const next = animationsCss.indexOf("@keyframes", start + 1);
      const keyframes = animationsCss.slice(start, next < 0 ? undefined : next);
      expect(keyframes).not.toMatch(/(?:width|height|margin|padding|top|left):/);
    }
  });
});
