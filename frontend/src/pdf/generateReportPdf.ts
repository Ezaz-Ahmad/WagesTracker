import type { DayComputed } from "../lib/aggregate";
import { weeklyPdfFilename } from "../lib/pdfFilename";
import type { WeekReportData } from "../lib/reportData";
import { fmt2 } from "../lib/date";
import { VERSION_SHORT } from "../lib/appVersion";
import { svgPathToJsPdfOps } from "./svgPathToJsPdf";
import { getPdfDelivery, type GeneratedPdfFile, type PdfDeliveryAdapter } from "../platform/pdfDelivery";

const ACCENT = "#ec3013";
const ACCENT_DARK = "#ae1800";
const ACCENT_TINT = "#ffc4b8";
const TEXT = "#201e1d";
const MUTED = "#6b6866";
const NEUTRAL_LIGHT = "#f8f4f4";
const DIVIDER = "#dedbda";
const DARK_AVATAR = "#444141";

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** The location(s) worked that day — fuel cost is logged per day, not per
 * shift, so a day with more than one shift/location joins them together. */
function dayLocations(d: DayComputed): string {
  const locs = Array.from(new Set(d.shifts.map((s) => s.location).filter(Boolean)));
  return locs.length ? locs.join(", ") : "—";
}

/** The real GitHub "octocat" mark (24x24 viewBox) — kept identical to
 * `GithubIcon` in `components/icons.tsx` so the PDF and the web app show
 * the same logo, not a second, different approximation of it. Traced as an
 * SVG path rather than drawn from circles/rects (the previous footer's
 * three-circle "cat silhouette" placeholder) so it reads as an actual,
 * recognizable brand mark instead of an abstract blob at footer scale.
 * Duplicated here (rather than imported) because this file has no React/JSX
 * dependency and generates the PDF from a plain async function — if this
 * path is ever intentionally changed, update the copy in `icons.tsx` too. */
const GITHUB_MARK_PATH_24 =
  "M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405 1.02 0 2.04.135 3 .405 2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z";

/** Draws the GitHub mark `h` mm tall with its top-left corner at (`x`, `y`) —
 * a real filled vector path, sharp at any zoom/print resolution, not a
 * rasterized bitmap. */
function drawGithubMark(doc: import("jspdf").jsPDF, x: number, y: number, h: number, color: string): void {
  const ops = svgPathToJsPdfOps(GITHUB_MARK_PATH_24, h / 24, x, y);
  doc.setFillColor(color);
  doc.path(ops);
  doc.fill();
}

/** A simple globe standing in for a "portfolio / website" mark — the same
 * circle+ellipse+line construction as `GlobeIcon` in `components/icons.tsx`,
 * just drawn with jsPDF's own vector primitives (already sharp at any zoom;
 * no path tracing needed for a shape this simple). Takes the same
 * (x, y, h) bounding-box footprint as `drawGithubMark` so the two icons
 * line up in the footer layout without each needing its own coordinate
 * convention. */
function drawPortfolioMark(doc: import("jspdf").jsPDF, x: number, y: number, h: number, color: string): void {
  const r = h / 2;
  const cx = x + r;
  const cy = y + r;
  doc.setDrawColor(color);
  doc.setLineWidth(0.26);
  doc.circle(cx, cy, r, "S");
  doc.ellipse(cx, cy, r * 0.45, r, "S");
  doc.line(cx - r, cy, cx + r, cy);
}

/** Small uppercase muted "SECTION LABEL" heading, the same treatment used
 * for every section in the report so the eye learns one pattern for "a new
 * section starts here" instead of every section introducing itself
 * differently. */
function drawSectionLabel(doc: import("jspdf").jsPDF, text: string, x: number, y: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED);
  doc.text(text.toUpperCase(), x, y);
}

function drawDivider(doc: import("jspdf").jsPDF, x1: number, x2: number, y: number, color = DIVIDER, width = 0.5): void {
  doc.setDrawColor(color);
  doc.setLineWidth(width);
  doc.line(x1, y, x2, y);
}

/** One stat tile: a soft rounded card with an accent-colored left edge,
 * a muted uppercase label, and a bold value — replaces the old bare
 * label/value pairs floating with no container, which is most of why the
 * summary row used to read as a loose list of numbers rather than a
 * designed dashboard strip. */
function drawStatCard(
  doc: import("jspdf").jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  valueColor: string,
  caption?: string
): void {
  doc.setFillColor(NEUTRAL_LIGHT);
  doc.roundedRect(x, y, w, h, 1.6, 1.6, "F");
  doc.setFillColor(ACCENT);
  doc.roundedRect(x, y, 1.4, h, 1.6, 1.6, "F");
  // Squares off the accent strip's outer corners (the rounded-rect above
  // rounds all four) so it reads as a flat tab against the card's left edge.
  doc.setFillColor(ACCENT);
  doc.rect(x + 0.7, y, 0.7, h, "F");

  const padX = x + 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(MUTED);
  doc.text(label.toUpperCase(), padX, y + 6.2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.5);
  doc.setTextColor(valueColor);
  // The optional caption (e.g. "Over 3 days") pushes the value up a touch so
  // both lines fit inside the same card height without crowding the label.
  doc.text(value, padX, y + (caption ? 12.6 : 13.8));
  if (caption) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.setTextColor(MUTED);
    doc.text(caption, padX, y + 16.4);
  }
}

/** A short, evenly-spaced row of stat cards. Row 1 (core stats) is always
 * 4-up and a fixed width regardless of what else is on the page; the
 * optional row (fuel/other earnings) instead sizes to however many cards it
 * actually has, so a single leftover card doesn't strand itself as a
 * narrow sliver next to empty space. */
function drawStatRow(
  doc: import("jspdf").jsPDF,
  marginX: number,
  contentW: number,
  y: number,
  h: number,
  cardCount: number,
  cards: { label: string; value: string; color: string; caption?: string }[]
): void {
  const gap = 4;
  const cardW = (contentW - gap * (cardCount - 1)) / cardCount;
  cards.forEach((c, i) => {
    const x = marginX + i * (cardW + gap);
    drawStatCard(doc, x, y, cardW, h, c.label, c.value, c.color, c.caption);
  });
}

export async function createReportPdf(data: WeekReportData): Promise<GeneratedPdfFile> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentW = pageW - marginX * 2;
  const footerH = 18;
  // Bottom of usable content on any page — leaves room for the footer band
  // so nothing can ever get silently drawn underneath it (the old layout had
  // no page-break handling at all, so a busy week — several shifts a day,
  // fuel cost, other earnings, multiple locations — could run past the
  // bottom of the page and just disappear under the footer).
  const footerLimit = pageH - footerH - 3;
  let y = 0;

  // Developer signature row layout — pulled into one place so the icon
  // size, baseline, and separators all share the same numbers instead of
  // several independently-eyeballed offsets drifting out of alignment.
  const SIGNATURE_ICON_H = 3.6;
  const SIGNATURE_FONT_SIZE = 8.3;
  const SIGNATURE_LINK_FONT_SIZE = 8;

  function drawFooter(): void {
    doc.setFillColor(NEUTRAL_LIGHT);
    doc.rect(0, pageH - footerH, pageW, footerH, "F");
    doc.setDrawColor(DIVIDER);
    doc.setLineWidth(0.3);
    doc.line(0, pageH - footerH, pageW, pageH - footerH);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(`Generated by Wage Tracker ${VERSION_SHORT} · ${data.generatedOnLabel}`, marginX, pageH - 12.2);

    // — developer signature: name, a subtle separator, then the GitHub and
    // Portfolio marks — each icon+label pair is one clickable region (a
    // real PDF link annotation, not just colored text) so clicking the icon
    // works exactly like clicking its label. Baseline-aligned: both icons
    // share one height and sit at the same offset above the text baseline,
    // and the vertical separators span the same distance around it, so
    // nothing looks like it was independently eyeballed into place.
    const creditY = pageH - 5.5;
    const iconY = creditY - SIGNATURE_ICON_H + 0.7;

    let cx = marginX;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(SIGNATURE_FONT_SIZE);
    doc.setTextColor(TEXT);
    const namePrefix = "Developed by Ezaz Ahmad";
    doc.text(namePrefix, cx, creditY);
    cx += doc.getTextWidth(namePrefix) + 3.4;

    function drawSeparator(): void {
      doc.setDrawColor(DIVIDER);
      doc.setLineWidth(0.35);
      doc.line(cx, creditY - 2.6, cx, creditY + 0.6);
      cx += 3.4;
    }

    drawSeparator();

    // GitHub mark + label, one clickable region
    const ghStart = cx;
    drawGithubMark(doc, cx, iconY, SIGNATURE_ICON_H, TEXT);
    cx += SIGNATURE_ICON_H + 1.8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(SIGNATURE_LINK_FONT_SIZE);
    doc.setTextColor(ACCENT_DARK);
    doc.text("GitHub", cx, creditY);
    const ghLabelW = doc.getTextWidth("GitHub");
    doc.link(ghStart - 0.8, creditY - 3.3, cx - ghStart + ghLabelW + 1.6, 4.4, { url: "https://github.com/Ezaz-Ahmad" });
    cx += ghLabelW + 5;

    drawSeparator();

    // Portfolio mark + label, one clickable region
    const pfStart = cx;
    drawPortfolioMark(doc, cx, iconY, SIGNATURE_ICON_H, ACCENT_DARK);
    cx += SIGNATURE_ICON_H + 1.8;
    doc.setTextColor(ACCENT_DARK);
    doc.text("Portfolio", cx, creditY);
    const pfLabelW = doc.getTextWidth("Portfolio");
    doc.link(pfStart - 0.8, creditY - 3.3, cx - pfStart + pfLabelW + 1.6, 4.4, { url: "https://www.ezazahmad.com/" });
  }

  // Call before drawing anything `min` mm tall — if it won't fit above the
  // footer, closes out the current page (footer + all) and starts a fresh
  // one. Every section below is guarded with this instead of assuming a
  // single page is always enough.
  function ensureSpace(min: number): void {
    if (y + min > footerLimit) {
      drawFooter();
      doc.addPage();
      y = 20;
    }
  }

  // — header band —
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, pageW, 17, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Wage Tracker", marginX, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("WEEKLY WAGE REPORT", pageW - marginX, 11, { align: "right" });

  // — employee identity + week tag —
  y = 30;
  doc.setFillColor(DARK_AVATAR);
  doc.circle(marginX + 5.5, y - 2, 5.5, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(data.employeeInitials, marginX + 5.5, y - 0.7, { align: "center" });

  doc.setTextColor(TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(data.employeeName || "—", marginX + 14.5, y - 2.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  // The employee's own address, not the work location — that's covered
  // separately by the "Worked at" stat and the shift table's location column.
  doc.text(data.employeeAddress || "—", marginX + 14.5, y + 3);

  doc.setDrawColor(ACCENT);
  doc.setTextColor(ACCENT);
  doc.setFontSize(8);
  const tagText = data.weekRangeLabel;
  const tagW = doc.getTextWidth(tagText) + 7;
  doc.setLineWidth(0.5);
  doc.roundedRect(pageW - marginX - tagW, y - 9, tagW, 6, 1, 1, "S");
  doc.text(tagText, pageW - marginX - tagW / 2, y - 5, { align: "center" });
  doc.setTextColor(MUTED);
  doc.setFontSize(8);
  doc.text(`Generated ${data.generatedOnLabel}`, pageW - marginX, y + 1, { align: "right" });

  y += 8;
  drawDivider(doc, marginX, pageW - marginX, y, DIVIDER, 0.6);

  // — summary stat cards —
  y += 8;
  const cardH = 18;
  drawStatRow(doc, marginX, contentW, y, cardH, 4, [
    { label: "Total hours", value: `${fmt2(data.totalHours)}h`, color: TEXT },
    { label: "Total earnings", value: `${data.currency}${fmt2(data.totalEarnings)}`, color: ACCENT_DARK },
    { label: "Hourly rate", value: `${data.currency}${fmt2(data.rate)}`, color: TEXT },
    { label: "Days worked", value: `${data.daysLogged} / 7`, color: TEXT },
  ]);
  y += cardH;

  // Fuel cost is a week total, but "$42.50" alone doesn't say whether that
  // was one big fill-up or several — the day count underneath makes it a
  // per-trip figure at a glance instead of a mystery lump sum.
  const fuelDayCount = data.days.filter((d) => d.fuelCost > 0).length;
  const extraCards = [
    ...(data.totalFuelCost > 0
      ? [
          {
            label: "Fuel cost",
            value: data.totalFuelCostLabel,
            color: ACCENT_DARK,
            caption: `Over ${fuelDayCount} day${fuelDayCount === 1 ? "" : "s"}`,
          },
        ]
      : []),
    ...(data.otherEarningAmount > 0 ? [{ label: "Other earnings", value: data.otherEarningAmountLabel, color: ACCENT_DARK }] : []),
  ];
  if (extraCards.length) {
    y += 4;
    drawStatRow(doc, marginX, contentW, y, cardH, extraCards.length, extraCards);
    y += cardH;
  }

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text(`Worked at ${data.locationsCountLabel}`, marginX, y);

  y += 5;
  drawDivider(doc, marginX, pageW - marginX, y);

  // — hours & daily pay by day (bar chart) — bar height is proportional to
  // hours worked that day, but the number printed above each bar is that
  // day's *total* pay, which includes fuel cost on top of hours × rate (see
  // buildDayComputed) — the heading and subtitle both say so explicitly, so
  // a day with fuel logged doesn't look like a miscalculated earnings figure
  // just because it's higher than hours × rate alone would suggest.
  ensureSpace(9 + 4 + 4 + 26 + 6 + 3.2 + 8);
  y += 9;
  drawSectionLabel(doc, "Hours & daily pay — earnings + fuel", marginX, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  doc.setTextColor(MUTED);
  doc.text("Daily total includes shift earnings plus any reimbursed fuel cost, where recorded.", marginX, y);
  y += 4;
  const chartH = 26;
  doc.setFillColor(NEUTRAL_LIGHT);
  doc.roundedRect(marginX, y, contentW, chartH, 2, 2, "F");
  const maxHours = Math.max(...data.days.map((d) => d.hours), 1);
  const dayW = contentW / 7;
  const barBase = y + chartH - 6;
  const barMaxH = chartH - 13;
  data.days.forEach((d, i) => {
    const cx = marginX + i * dayW + dayW / 2;
    if (d.hours <= 0) return; // no bar, no label — an empty day just stays empty, not a stray dash.
    const barH = Math.max(3, (d.hours / maxHours) * barMaxH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(ACCENT_DARK);
    doc.text(d.moneyLabel, cx, barBase - barH - 2.2, { align: "center" });
    doc.setFillColor(d.isToday ? ACCENT : ACCENT_TINT);
    doc.roundedRect(cx - dayW * 0.16, barBase - barH, dayW * 0.32, barH, 0.8, 0.8, "F");
  });
  // Baseline the bars sit on — makes even a chart with mostly-empty days read
  // as "a chart with quiet days" instead of "a chart that's broken".
  drawDivider(doc, marginX + 3, marginX + contentW - 3, barBase, "#e3dfde", 0.4);

  y += chartH + 6;
  data.days.forEach((d, i) => {
    const cx = marginX + i * dayW + dayW / 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.setTextColor(d.isToday ? ACCENT_DARK : TEXT);
    doc.text(d.dayAbbr, cx, y, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(MUTED);
    doc.text(d.dateLabel, cx, y + 3.2, { align: "center" });
  });

  // — shift table —
  ensureSpace(10 + 5 + 2.5 + 5 + 5.8 * Math.min(3, data.shiftRows.length || 1));
  y += 10;
  const cols = [
    { key: "day", label: "Day", w: 0.11 },
    { key: "date", label: "Date", w: 0.14 },
    { key: "location", label: "Location", w: 0.27 },
    { key: "signIn", label: "Sign in", w: 0.13 },
    { key: "signOut", label: "Sign out", w: 0.13 },
    { key: "hoursLabel", label: "Hours", w: 0.11 },
    { key: "moneyLabel", label: "Earnings", w: 0.11 },
  ] as const;
  const colX: number[] = [];
  let cx0 = marginX;
  cols.forEach((c) => {
    colX.push(cx0);
    cx0 += contentW * c.w;
  });

  function drawShiftColHeader(): void {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    cols.forEach((c, i) => doc.text(c.label.toUpperCase(), colX[i], y));
    y += 2.5;
    drawDivider(doc, marginX, pageW - marginX, y);
    y += 5;
  }

  drawSectionLabel(doc, "Shifts this week", marginX, y);
  y += 5;
  drawShiftColHeader();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  if (data.shiftRows.length) {
    data.shiftRows.forEach((r, i) => {
      // A row that won't fit above the footer starts a fresh page instead of
      // being clipped or drawn underneath the footer band — with the column
      // headers repeated, so the new page's table is still self-explanatory.
      if (y + 5.8 > footerLimit) {
        drawFooter();
        doc.addPage();
        y = 20;
        drawSectionLabel(doc, "Shifts this week (continued)", marginX, y);
        y += 5;
        drawShiftColHeader();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
      }
      if (i % 2 === 1) {
        doc.setFillColor(NEUTRAL_LIGHT);
        doc.rect(marginX, y - 3.6, contentW, 5.8, "F");
      }
      doc.setTextColor(TEXT);
      doc.text(r.day, colX[0], y);
      doc.text(r.date, colX[1], y);
      doc.text(truncate(r.location, 24), colX[2], y);
      doc.text(r.signIn, colX[3], y);
      doc.text(r.signOut, colX[4], y);
      doc.text(r.hoursLabel, colX[5], y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(ACCENT_DARK);
      doc.text(r.moneyLabel, colX[6], y);
      doc.setFont("helvetica", "normal");
      y += 5.8;
    });
  } else {
    doc.setTextColor(MUTED);
    doc.text("No shifts logged this week.", marginX, y);
    y += 5.8;
  }

  // — dedicated fuel cost section: a small day-by-day breakdown of fuel
  // reimbursements. This is now the *only* place fuel shows up per day (the
  // chart above used to also annotate it inline, which just meant the same
  // number appeared twice a few centimeters apart).
  const fuelDays = data.days.filter((d) => d.fuelCost > 0);
  if (fuelDays.length) {
    ensureSpace(5 + 8 + 5 + 2.5 + 5 + 5.8 * Math.min(3, fuelDays.length));
    y += 5;
    drawDivider(doc, marginX, pageW - marginX, y);
    y += 8;
    drawSectionLabel(doc, "Fuel cost by day", marginX, y);
    y += 5;

    const fuelCols = [
      { key: "day", label: "Day", w: 0.11 },
      { key: "date", label: "Date", w: 0.18 },
      { key: "location", label: "Location", w: 0.44 },
      { key: "fuel", label: "Fuel cost", w: 0.27 },
    ] as const;
    const fuelColX: number[] = [];
    let fcx0 = marginX;
    fuelCols.forEach((c) => {
      fuelColX.push(fcx0);
      fcx0 += contentW * c.w;
    });

    function drawFuelColHeader(): void {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(MUTED);
      fuelCols.forEach((c, i) => doc.text(c.label.toUpperCase(), fuelColX[i], y));
      y += 2.5;
      drawDivider(doc, marginX, pageW - marginX, y);
      y += 5;
    }

    drawFuelColHeader();

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    fuelDays.forEach((d, i) => {
      if (y + 5.8 > footerLimit) {
        drawFooter();
        doc.addPage();
        y = 20;
        drawSectionLabel(doc, "Fuel cost by day (continued)", marginX, y);
        y += 5;
        drawFuelColHeader();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
      }
      if (i % 2 === 1) {
        doc.setFillColor(NEUTRAL_LIGHT);
        doc.rect(marginX, y - 3.6, contentW, 5.8, "F");
      }
      doc.setTextColor(TEXT);
      doc.text(d.dayAbbr, fuelColX[0], y);
      doc.text(d.dateLabel, fuelColX[1], y);
      doc.text(truncate(dayLocations(d), 30), fuelColX[2], y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(ACCENT_DARK);
      doc.text(d.fuelCostLabel, fuelColX[3], y);
      doc.setFont("helvetica", "normal");
      y += 5.8;
    });
  }

  // — other earnings: a single week-level amount (tip, bonus, reimbursement),
  // always shown with the reason the user gave for it.
  if (data.otherEarningAmount > 0) {
    const reasonLinesPreview = doc.splitTextToSize(data.otherEarningReason || "No reason given.", contentW - 34);
    const boxHPreview = Math.max(11, 5 + reasonLinesPreview.length * 4);
    ensureSpace(5 + 8 + 5.5 + boxHPreview);
    y += 5;
    drawDivider(doc, marginX, pageW - marginX, y);
    y += 8;
    drawSectionLabel(doc, "Other earnings", marginX, y);
    y += 5.5;

    const reasonLines = doc.splitTextToSize(data.otherEarningReason || "No reason given.", contentW - 34);
    const boxH = Math.max(11, 5 + reasonLines.length * 4);
    doc.setFillColor(NEUTRAL_LIGHT);
    doc.roundedRect(marginX, y - 5.5, contentW, boxH, 1.6, 1.6, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(ACCENT_DARK);
    doc.text(data.otherEarningAmountLabel, marginX + 5, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT);
    doc.text(reasonLines, marginX + 30, y - 0.5);

    y += boxH + 1;
  }

  if (data.multiLocation && data.locationBreakdown.length) {
    ensureSpace(5 + 8 + 5 + 8);
    y += 5;
    drawDivider(doc, marginX, pageW - marginX, y);
    y += 8;
    drawSectionLabel(doc, "By location", marginX, y);
    // +6.5 (not +5) so the box top lands just below the label's text
    // baseline instead of 0.5mm above it — the tighter gap was slicing
    // through the bottom of the "BY LOCATION" letters.
    y += 6.5;
    const rowH = 8;
    doc.setFillColor(NEUTRAL_LIGHT);
    doc.roundedRect(marginX, y - 5.5, contentW, rowH, 1.6, 1.6, "F");
    let lx = marginX + 5;
    data.locationBreakdown.forEach((lb) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(TEXT);
      doc.text(lb.location, lx, y);
      const w1 = doc.getTextWidth(lb.location);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(MUTED);
      const rest = `  —  ${lb.hoursLabel} · ${lb.moneyLabel}`;
      doc.text(rest, lx + w1, y);
      lx += w1 + doc.getTextWidth(rest) + 11;
    });
    y += rowH - 1.5;
  }

  // — total —
  ensureSpace(7 + 8 + 4.5);
  y += 7;
  doc.setDrawColor(TEXT);
  doc.setLineWidth(0.8);
  doc.line(marginX, y, pageW - marginX, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(TEXT);
  doc.text("Total", marginX, y);
  doc.setTextColor(ACCENT_DARK);
  doc.text(`${fmt2(data.totalHours)}h · ${data.currency}${fmt2(data.totalEarnings)}`, pageW - marginX, y, { align: "right" });
  if (data.totalFuelCost > 0 || data.otherEarningAmount > 0) {
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(MUTED);
    const parts = [
      data.totalFuelCost > 0 ? `${data.totalFuelCostLabel} fuel cost` : null,
      data.otherEarningAmount > 0 ? `${data.otherEarningAmountLabel} other earnings` : null,
    ].filter(Boolean);
    doc.text(`Includes ${parts.join(" + ")}`, pageW - marginX, y, { align: "right" });
  }

  // — footer: a subtle highlighted band carrying the report attribution and,
  // below it, a small credit row with drawn GitHub/globe marks that link out.
  // Drawn once here for whatever the final page turns out to be — every
  // earlier page got its own footer already, right before its page break.
  drawFooter();

  // One shared rule for every weekly PDF, current week or historical — see
  // lib/pdfFilename.ts. It replaces a local scheme that lower-cased and
  // hyphenated the name (dropping capitalisation and every non-ASCII
  // character) and used the prose date range, which sorts alphabetically by
  // month name rather than chronologically.
  return {
    filename: weeklyPdfFilename(data.employeeName, data.weekStartISO, data.weekEndISO),
    bytes: doc.output("arraybuffer"),
  };
}

export async function generateReportPdf(
  data: WeekReportData,
  delivery: PdfDeliveryAdapter = getPdfDelivery()
): Promise<void> {
  await delivery.deliver(await createReportPdf(data));
}
