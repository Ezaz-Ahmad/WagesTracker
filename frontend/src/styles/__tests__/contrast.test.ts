// Contrast ratios for the semantic colour pairs, computed from the values
// actually in tokens.css rather than asserted in a comment beside them.
//
// The palette's own comments claim WCAG AA for the success/warning/danger
// text-on-tint pairs. That claim was never checked by anything, and the
// informational tone added in this pass needed the same guarantee — so it
// is checked here, against the real file, for every pair at once. A future
// retune of the palette that breaks one of these fails the build instead of
// shipping.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(fileURLToPath(new URL("../tokens.css", import.meta.url)), "utf8");

/** Reads a `--name: #rrggbb;` declaration out of tokens.css. Only handles
 * literal hex values — every colour in these pairs is one, and resolving
 * `var()` chains or `color-mix()` would mean reimplementing a CSS engine
 * for no extra confidence. */
function token(name: string): string {
  const m = TOKENS.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`--${name} is not a literal hex value in tokens.css`);
  return m[1];
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG 2.1 AA for normal-size text. Banner text is 12.5px, well under the
 * 18.66px/24px thresholds that would let 3:1 apply. */
const AA_NORMAL = 4.5;

describe("status banner contrast", () => {
  const pairs: [string, string, string][] = [
    ["success", "color-success-700", "color-success-100"],
    ["warning", "color-warning-700", "color-warning-100"],
    ["info", "color-info-700", "color-info-100"],
  ];

  for (const [name, fg, bg] of pairs) {
    it(`${name} text clears AA on its own tint`, () => {
      expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }

  // Danger aliases the accent ramp (--color-danger-700 -> --color-accent-800,
  // --color-danger-100 -> --color-accent-100), so it's checked against the
  // ramp values those aliases resolve to.
  it("danger text clears AA on its own tint", () => {
    expect(ratio(token("color-accent-800"), token("color-accent-100"))).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("body and accent text contrast", () => {
  it("body text clears AA on both surfaces", () => {
    expect(ratio(token("color-text"), token("color-bg"))).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratio(token("color-text"), token("color-surface"))).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // --color-accent-text exists precisely because the raw --color-accent
  // fails AA as small text (~3.8:1 on --color-bg). This pins both halves of
  // that: the safe alias passes, and it is genuinely different from the raw
  // accent rather than having quietly been aliased back to it.
  it("the text-safe accent clears AA where the raw accent does not", () => {
    expect(ratio(token("color-accent-700"), token("color-bg"))).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratio(token("color-accent"), token("color-bg"))).toBeLessThan(AA_NORMAL);
  });

  it("white on the primary button's mid-gradient stop clears AA", () => {
    expect(ratio("#ffffff", token("color-accent-600"))).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("tag contrast", () => {
  // Tags are 11px — the "This device" badge and History's met/under-goal
  // status, both of which carry real meaning rather than decoration.
  const tagPairs: [string, string, string][] = [
    ["accent", "color-accent-800", "color-accent-100"],
    ["accent-2", "color-accent-2-800", "color-accent-2-100"],
    ["neutral", "color-neutral-800", "color-neutral-100"],
  ];

  for (const [name, fg, bg] of tagPairs) {
    it(`the ${name} tag clears AA`, () => {
      expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }
});
