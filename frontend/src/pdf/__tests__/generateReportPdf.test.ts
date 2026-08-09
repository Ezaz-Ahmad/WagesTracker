import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { buildWeekReportData } from "../../lib/reportData";
import type { DayExpense, Shift, User } from "../../lib/types";

// generateReportPdf reads a shared version string from lib/appVersion, whose
// real implementation depends on Vite `define`-injected build-time globals
// that don't exist under plain Vitest. Mocking it to a known, distinctive
// value lets these tests assert the PDF's footer text comes from that one
// shared module — the same thing Settings' AppCredit reads — rather than a
// value generateReportPdf made up on its own.
// Deliberately parenthesis-free: PDF string literals escape literal "(" and
// ")" as "\(" / "\)", which would make a naive substring match against the
// real `v9.9.9 (deadbee)`-shaped format fail for reasons that have nothing
// to do with what this test actually cares about (that the value came from
// the shared module, not that PDF string escaping works).
const FAKE_VERSION_SHORT = "TESTVERSION-9-9-9-deadbee";
vi.mock("../../lib/appVersion", () => ({
  VERSION_SHORT: FAKE_VERSION_SHORT,
  VERSION_LABEL: `${FAKE_VERSION_SHORT} · Jan 1, 2030`,
}));

// jsPDF's own `.save()` triggers a browser download — not available (or
// wanted) under Node. Every jsPDF instance gets `save` copied onto it at
// construction time from `jsPDF.API` (it's a per-instance own property, not
// on the prototype), so the plugin object itself is what needs patching for
// the override to reach instances created *inside* generateReportPdf.
let lastBuffer: Buffer | null = null;
beforeAll(() => {
  (jsPDF as unknown as { API: Record<string, unknown> }).API.save = function (this: jsPDF) {
    lastBuffer = Buffer.from(this.output("arraybuffer") as ArrayBuffer);
  };
});

const CURRENCY = "$";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    name: "Alex Rivera",
    email: "alex@example.com",
    address: "123 Main St",
    workLocationName: "Downtown Store",
    workAddress: "456 Market St",
    multipleLocations: false,
    otherLocations: "",
    weekStartsOn: "Monday",
    rate: 20,
    goalHours: 35,
    goalEarnings: 700,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Renders a report and returns the raw PDF bytes as a latin1 string — the
 * standard 14 fonts (Helvetica) aren't embedded/re-encoded, and this
 * generator never turns on stream compression, so every literal piece of
 * text drawn with `doc.text()` (headings, labels, dollar amounts, link URLs)
 * shows up as plain readable bytes in the file, exactly like `grep`ping the
 * PDF would. Using this instead of a real PDF-parsing dependency keeps these
 * tests fast and dependency-free while still asserting on what's genuinely
 * in the output file, not just what the code intended to draw. */
async function renderToBytes(data: Awaited<ReturnType<typeof buildWeekReportData>>): Promise<string> {
  const { generateReportPdf } = await import("../generateReportPdf");
  await generateReportPdf(data);
  if (!lastBuffer) throw new Error("doc.save() was never called");
  return lastBuffer.toString("latin1");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("generateReportPdf", () => {
  it("shows the combined shift-earnings-plus-fuel amount on a day that has both", async () => {
    const user = makeUser({ rate: 90 });
    const today = new Date(2026, 7, 9); // Sunday
    const shifts: Shift[] = [{ id: "1", date: "2026-08-05", location: "Store", signIn: "06:00", signOut: "22:00" }]; // 16h * $90 = $1440
    const dayExpenses: DayExpense[] = [{ date: "2026-08-05", fuelCost: 35 }];
    const data = buildWeekReportData(user, shifts, today, CURRENCY, dayExpenses, []);

    expect(data.days.find((d) => d.dateISO === "2026-08-05")?.moneyLabel).toBe("$1475.00");

    const pdf = await renderToBytes(data);
    expect(pdf).toContain("$1475.00");
  });

  it("uses a chart heading that explicitly names both earnings and fuel", async () => {
    const user = makeUser();
    const data = buildWeekReportData(user, [], new Date(2026, 7, 9), CURRENCY, [], []);
    const pdf = await renderToBytes(data);
    // drawSectionLabel uppercases whatever string it's given.
    expect(pdf).toContain("HOURS & DAILY PAY");
    expect(pdf).toContain("EARNINGS + FUEL");
  });

  it("includes the explanatory subtitle beneath the chart heading", async () => {
    const user = makeUser();
    const data = buildWeekReportData(user, [], new Date(2026, 7, 9), CURRENCY, [], []);
    const pdf = await renderToBytes(data);
    expect(pdf).toContain("Daily total includes shift earnings plus any reimbursed fuel cost, where recorded.");
  });

  it("shows only the shift-earnings amount on a day with no fuel logged", async () => {
    const user = makeUser({ rate: 25 });
    const today = new Date(2026, 7, 9);
    const shifts: Shift[] = [{ id: "1", date: "2026-08-04", location: "Store", signIn: "09:00", signOut: "17:00" }]; // 8h * $25 = $200
    const data = buildWeekReportData(user, shifts, today, CURRENCY, [], []);

    const tuesday = data.days.find((d) => d.dateISO === "2026-08-04");
    expect(tuesday?.moneyLabel).toBe("$200.00");
    expect(tuesday?.fuelCost).toBe(0);

    const pdf = await renderToBytes(data);
    expect(pdf).toContain("$200.00");
  });

  it("counts fuel exactly once in the week's total — once in the stat card, once in the fuel breakdown, never a third time", async () => {
    const user = makeUser({ rate: 20 });
    const today = new Date(2026, 7, 9);
    const shifts: Shift[] = [{ id: "1", date: "2026-08-03", location: "Store", signIn: "09:00", signOut: "13:00" }]; // 4h * $20 = $80
    // A distinctive amount unlikely to collide with any other figure drawn
    // on the page, so counting its literal occurrences is a meaningful check.
    const dayExpenses: DayExpense[] = [{ date: "2026-08-03", fuelCost: 37.13 }];
    const data = buildWeekReportData(user, shifts, today, CURRENCY, dayExpenses, []);

    expect(data.totalFuelCost).toBe(37.13);
    expect(data.totalEarnings).toBe(80 + 37.13); // fuel added once, on top of hourly wages

    const pdf = await renderToBytes(data);
    // The fuel figure is legitimately *displayed* in three places — the
    // "Fuel cost" stat card, the "Fuel cost by day" row, and the caption
    // under the grand total ("Includes $37.13 fuel cost") — but the
    // *arithmetic* (asserted above) only ever adds it once. If fuel were
    // being double-counted in the total, or if the old chart-level fuel
    // annotation this redesign removed had crept back in, this count would
    // be higher than the three genuine, accounted-for occurrences.
    expect(countOccurrences(pdf, "$37.13")).toBe(3);
  });

  it("keeps the dedicated 'Fuel cost by day' breakdown, with the correct day and amount", async () => {
    const user = makeUser({ rate: 20 });
    const today = new Date(2026, 7, 9);
    const dayExpenses: DayExpense[] = [{ date: "2026-08-06", fuelCost: 18.5 }];
    const data = buildWeekReportData(user, [], today, CURRENCY, dayExpenses, []);

    const pdf = await renderToBytes(data);
    expect(pdf).toContain("FUEL COST BY DAY");
    expect(pdf).toContain("$18.50");
  });

  it("shows 'Developed by Ezaz Ahmad' in the footer (not the old 'Built by' wording)", async () => {
    const user = makeUser();
    const data = buildWeekReportData(user, [], new Date(2026, 7, 9), CURRENCY, [], []);
    const pdf = await renderToBytes(data);
    expect(pdf).toContain("Developed by Ezaz Ahmad");
    expect(pdf).not.toContain("Built by Ezaz Ahmad");
  });

  it("shows both the GitHub and Portfolio labels", async () => {
    const user = makeUser();
    const data = buildWeekReportData(user, [], new Date(2026, 7, 9), CURRENCY, [], []);
    const pdf = await renderToBytes(data);
    expect(pdf).toContain("GitHub");
    expect(pdf).toContain("Portfolio");
  });

  it("attaches the correct GitHub and portfolio URLs as real clickable PDF link annotations", async () => {
    const user = makeUser();
    const data = buildWeekReportData(user, [], new Date(2026, 7, 9), CURRENCY, [], []);
    const pdf = await renderToBytes(data);

    // A real link annotation, not just colored text: /Subtype /Link objects
    // carrying a /URI action.
    expect(pdf).toMatch(/\/Subtype\s*\/Link/);
    expect(pdf).toContain("/URI (https://github.com/Ezaz-Ahmad)");
    expect(pdf).toContain("/URI (https://www.ezazahmad.com/)");
  });

  it("shows the shared app version (and git hash) from lib/appVersion, not a value of its own", async () => {
    const user = makeUser();
    const data = buildWeekReportData(user, [], new Date(2026, 7, 9), CURRENCY, [], []);
    const pdf = await renderToBytes(data);
    expect(pdf).toContain(FAKE_VERSION_SHORT);
  });

  it("shows the report's generated-on date in the footer", async () => {
    const user = makeUser();
    const today = new Date(2026, 7, 9);
    const data = buildWeekReportData(user, [], today, CURRENCY, [], []);
    const pdf = await renderToBytes(data);
    expect(pdf).toContain(data.generatedOnLabel);
  });

  it("draws the same footer (name + both link annotations) on every page of a multi-page report", async () => {
    const user = makeUser({ rate: 15, multipleLocations: true });
    const today = new Date(2026, 7, 9);
    // Enough shift rows to force the table past one page.
    const shifts: Shift[] = [];
    const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
    for (const date of dates) {
      for (let i = 0; i < 6; i++) {
        const h = 6 + i * 3;
        shifts.push({
          id: `${date}-${i}`,
          date,
          location: `Location ${i}`,
          signIn: `${String(h).padStart(2, "0")}:00`,
          signOut: `${String(h + 2).padStart(2, "0")}:00`,
        });
      }
    }
    const data = buildWeekReportData(user, shifts, today, CURRENCY, [], []);
    expect(data.shiftRows.length).toBeGreaterThan(20);

    const pdf = await renderToBytes(data);
    // "/Type /Page" (a page object) vs. "/Type /Pages" (the page tree root)
    // — the negative lookahead is what tells them apart.
    const pageCount = (pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    // Every page draws its own footer via the same drawFooter() call, so the
    // signature and its two link annotations should appear once per page.
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect(countOccurrences(pdf, "Developed by Ezaz Ahmad")).toBe(pageCount);
    const linkAnnotationCount = (pdf.match(/\/Subtype\s*\/Link/g) ?? []).length;
    expect(linkAnnotationCount).toBe(pageCount * 2);
  });

  it("does not hard-code a version number in the PDF generator itself", () => {
    const sourcePath = fileURLToPath(new URL("../generateReportPdf.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain('from "../lib/appVersion"');
    // No literal "vX.Y.Z"-shaped string anywhere outside of that import.
    const withoutImportLine = source.replace(/^import.*appVersion.*$/m, "");
    expect(withoutImportLine).not.toMatch(/["'`]v\d+\.\d+\.\d+/);
  });
});
