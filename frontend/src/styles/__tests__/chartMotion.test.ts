import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const animations = read("../animations.css");
const app = read("../../App.tsx");
const home = read("../../screens/HomeScreen.tsx");
const report = read("../../screens/ReportScreen.tsx");
const weeklyTrend = read("../../components/WeeklyTrendChart.tsx");
const spending = read("../../screens/SpendingScreen.tsx");

function keyframes(name: string): string {
  const match = animations.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing @keyframes ${name}`);
  return match[1];
}

describe("premium chart motion", () => {
  it("uses a dedicated chart duration near one second", () => {
    const duration = Number(animations.match(/--dur-chart:\s*(\d+)ms/)?.[1]);
    const delay = Number(animations.match(/--delay-chart:\s*(\d+)ms/)?.[1]);
    expect(duration).toBeGreaterThanOrEqual(700);
    expect(duration).toBeLessThanOrEqual(1100);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(220);
  });

  it("covers every chart family with visibility-gated entrance motion", () => {
    for (const selector of [
      ".period-bar-fill",
      ".glance-bar-fill",
      ".goal-ring-fill",
      ".chart-line-draw",
      ".home-spending-donut::before",
      ".spending-donut::before",
      ".spending-trend-track span",
      ".comparison-bars i",
    ]) {
      expect(animations).toContain(selector);
    }
    expect(animations).toContain(".chart-reveal.is-chart-visible");
    expect(animations).toContain("@property --donut-reveal-angle");
  });

  it("gives each visible chart family the shared premium-duration animation", () => {
    for (const rule of [
      /\.chart-reveal\.is-chart-visible \.progress-fill\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
      /\.chart-reveal\.is-chart-visible \.period-bar-fill\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
      /\.chart-reveal\.is-chart-visible \.glance-bar-fill\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
      /\.chart-reveal\.is-chart-visible \.goal-ring-fill\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
      /\.chart-reveal\.is-chart-visible \.chart-line-draw\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
      /\.chart-reveal\.is-chart-visible \.spending-trend-track span\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
      /\.chart-reveal\.is-chart-visible \.comparison-bars i\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
      /\.spending-donut\.supports-donut-sweep::before\s*\{[^}]*animation:[^}]*var\(--dur-chart\)/,
    ]) {
      expect(animations).toMatch(rule);
    }
  });

  it("provides a smooth old-WebKit donut fallback as well as the segment sweep", () => {
    expect(animations).toMatch(/\.chart-reveal\.is-chart-visible \.spending-donut\s*\{[^}]*animation:\s*donut-fallback-reveal var\(--dur-chart\)/);
    expect(animations).toContain("supports-donut-sweep");
  });

  it("animates bars on the compositor rather than changing layout geometry", () => {
    for (const name of ["bar-grow", "comparison-bar-reveal"]) {
      expect(keyframes(name)).toMatch(/transform:/);
      expect(keyframes(name)).not.toMatch(/(?:width|height|margin|padding|top|right|bottom|left)\s*:/);
    }
  });

  it("naturally resets reveals on each tab visit without live-value replay keys", () => {
    expect(app).toMatch(/<div key=\{screen\} className=\{screenTransitionClass\}>/);
    expect(home).toContain("useChartReveal");
    expect(report).toContain("useChartReveal");
    expect(weeklyTrend).toContain("useChartReveal");
    expect(spending).toContain("useChartReveal");
    expect(report).toContain('key={`${metric}:${period}`}');
    expect(spending).toContain('key={`${summary.period.from}:${summary.period.to}`}');
  });

  it("keeps the global reduced-motion safety net", () => {
    expect(animations).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms !important/);
    expect(animations).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-delay:\s*0\.01ms !important/);
  });
});
