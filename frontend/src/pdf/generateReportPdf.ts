import type { DayComputed } from "../lib/aggregate";
import type { WeekReportData } from "../lib/reportData";
import { fmt2 } from "../lib/date";

const ACCENT = "#ec3013";
const ACCENT_DARK = "#ae1800";
const ACCENT_TINT = "#ffc4b8";
const TEXT = "#201e1d";
const MUTED = "#6b6866";
const NEUTRAL_LIGHT = "#f8f4f4";
const DIVIDER = "#c9c6c5";
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

/** Small drawn "cat" silhouette standing in for the GitHub mark — three
 * circles read as a head + ears at footer scale, next to a "GitHub" label
 * there's no ambiguity about what it links to. */
function drawGithubMark(doc: import("jspdf").jsPDF, cx: number, cy: number, r: number, color: string): void {
  doc.setFillColor(color);
  doc.circle(cx - r * 0.55, cy - r * 0.5, r * 0.4, "F");
  doc.circle(cx + r * 0.55, cy - r * 0.5, r * 0.4, "F");
  doc.circle(cx, cy + r * 0.1, r * 0.78, "F");
}

/** Small drawn globe standing in for a "portfolio / website" mark. */
function drawGlobeMark(doc: import("jspdf").jsPDF, cx: number, cy: number, r: number, color: string): void {
  doc.setDrawColor(color);
  doc.setLineWidth(0.22);
  doc.circle(cx, cy, r, "S");
  doc.ellipse(cx, cy, r * 0.45, r, "S");
  doc.line(cx - r, cy, cx + r, cy);
}

export async function generateReportPdf(data: WeekReportData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentW = pageW - marginX * 2;
  let y = 0;

  doc.setFillColor(ACCENT);
  doc.rect(0, 0, pageW, 16, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Wage Tracker", marginX, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("WEEKLY WAGE REPORT", pageW - marginX, 10, { align: "right" });

  y = 27;
  doc.setFillColor(DARK_AVATAR);
  doc.circle(marginX + 5, y - 2, 5, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(data.employeeInitials, marginX + 5, y - 0.8, { align: "center" });

  doc.setTextColor(TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(data.employeeName || "—", marginX + 13, y - 2.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  // The employee's own address, not the work location — that's covered
  // separately by the "Worked at" stat and the shift table's location column.
  doc.text(data.employeeAddress || "—", marginX + 13, y + 2.5);

  doc.setDrawColor(ACCENT);
  doc.setTextColor(ACCENT);
  doc.setFontSize(8);
  const tagText = data.weekRangeLabel;
  const tagW = doc.getTextWidth(tagText) + 6;
  doc.setLineWidth(0.4);
  doc.rect(pageW - marginX - tagW, y - 8, tagW, 5.5, "S");
  doc.text(tagText, pageW - marginX - tagW / 2, y - 4.5, { align: "center" });
  doc.setTextColor(MUTED);
  doc.setFontSize(8);
  doc.text(`Generated ${data.generatedOnLabel}`, pageW - marginX, y + 1, { align: "right" });

  y += 7;
  doc.setDrawColor(DIVIDER);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, pageW - marginX, y);

  y += 9;
  const tiles = [
    { label: "TOTAL HOURS", value: `${fmt2(data.totalHours)}h`, color: TEXT },
    { label: "TOTAL EARNINGS", value: `${data.currency}${data.totalEarnings.toFixed(2)}`, color: ACCENT_DARK },
    { label: "HOURLY RATE", value: `${data.currency}${data.rate}`, color: TEXT },
    { label: "DAYS WORKED", value: `${data.daysLogged} / 7`, color: TEXT },
    ...(data.totalFuelCost > 0 ? [{ label: "FUEL COST", value: data.totalFuelCostLabel, color: ACCENT_DARK }] : []),
    ...(data.otherEarningAmount > 0 ? [{ label: "OTHER EARNINGS", value: data.otherEarningAmountLabel, color: ACCENT_DARK }] : []),
  ];
  const tileW = contentW / tiles.length;
  tiles.forEach((t, i) => {
    const x = marginX + i * tileW;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(t.label, x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(t.color);
    doc.text(t.value, x, y + 6);
  });

  y += 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(`Worked at  ${data.locationsCountLabel}`, marginX, y);

  y += 4;
  doc.setDrawColor(DIVIDER);
  doc.line(marginX, y, pageW - marginX, y);

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text("HOURS & EARNINGS BY DAY", marginX, y);
  y += 3;
  const chartH = 22;
  doc.setFillColor(NEUTRAL_LIGHT);
  doc.rect(marginX, y, contentW, chartH, "F");
  const maxHours = Math.max(...data.days.map((d) => d.hours), 1);
  const dayW = contentW / 7;
  const barBase = y + chartH - 8;
  const barMaxH = chartH - 10;
  data.days.forEach((d, i) => {
    const barH = d.hours > 0 ? Math.max(2, (d.hours / maxHours) * barMaxH) : 1;
    const cx = marginX + i * dayW + dayW / 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(ACCENT_DARK);
    doc.text(d.moneyLabel, cx, barBase - barH - 2, { align: "center" });
    doc.setFillColor(d.isToday ? ACCENT : ACCENT_TINT);
    doc.rect(cx - dayW * 0.18, barBase - barH, dayW * 0.36, barH, "F");
  });
  y += chartH + 5;
  const anyFuel = data.days.some((d) => d.fuelCost > 0);
  data.days.forEach((d, i) => {
    const cx = marginX + i * dayW + dayW / 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT);
    doc.text(d.dayAbbr, cx, y, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(MUTED);
    doc.text(d.dateLabel, cx, y + 3, { align: "center" });
    if (d.fuelCost > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(ACCENT_DARK);
      doc.text(`Fuel ${d.fuelCostLabel}`, cx, y + 6.5, { align: "center" });
    }
  });

  y += anyFuel ? 12 : 8;
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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  cols.forEach((c, i) => doc.text(c.label.toUpperCase(), colX[i], y));
  y += 2;
  doc.setDrawColor(DIVIDER);
  doc.line(marginX, y, pageW - marginX, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  if (data.shiftRows.length) {
    data.shiftRows.forEach((r, i) => {
      if (i % 2 === 1) {
        doc.setFillColor(NEUTRAL_LIGHT);
        doc.rect(marginX, y - 3.2, contentW, 5.2, "F");
      }
      doc.setTextColor(TEXT);
      doc.text(r.day, colX[0], y);
      doc.text(r.date, colX[1], y);
      doc.text(truncate(r.location, 24), colX[2], y);
      doc.text(r.signIn, colX[3], y);
      doc.text(r.signOut, colX[4], y);
      doc.text(r.hoursLabel, colX[5], y);
      doc.setTextColor(ACCENT_DARK);
      doc.text(r.moneyLabel, colX[6], y);
      y += 5.2;
    });
  } else {
    doc.setTextColor(MUTED);
    doc.text("No shifts logged this week.", marginX, y);
    y += 5.2;
  }

  // — dedicated fuel cost section: a small day-by-day breakdown of fuel
  // reimbursements, so they're not just buried inside the day totals above.
  const fuelDays = data.days.filter((d) => d.fuelCost > 0);
  if (fuelDays.length) {
    y += 2;
    doc.setDrawColor(DIVIDER);
    doc.line(marginX, y, pageW - marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text("FUEL COST BY DAY", marginX, y);
    y += 4;

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

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(MUTED);
    fuelCols.forEach((c, i) => doc.text(c.label.toUpperCase(), fuelColX[i], y));
    y += 2;
    doc.setDrawColor(DIVIDER);
    doc.line(marginX, y, pageW - marginX, y);
    y += 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    fuelDays.forEach((d, i) => {
      if (i % 2 === 1) {
        doc.setFillColor(NEUTRAL_LIGHT);
        doc.rect(marginX, y - 3.2, contentW, 5.2, "F");
      }
      doc.setTextColor(TEXT);
      doc.text(d.dayAbbr, fuelColX[0], y);
      doc.text(d.dateLabel, fuelColX[1], y);
      doc.text(truncate(dayLocations(d), 30), fuelColX[2], y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(ACCENT_DARK);
      doc.text(d.fuelCostLabel, fuelColX[3], y);
      doc.setFont("helvetica", "normal");
      y += 5.2;
    });
  }

  // — other earnings: a single week-level amount (tip, bonus, reimbursement),
  // always shown with the reason the user gave for it.
  if (data.otherEarningAmount > 0) {
    y += 2;
    doc.setDrawColor(DIVIDER);
    doc.line(marginX, y, pageW - marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text("OTHER EARNINGS", marginX, y);
    y += 5;

    doc.setFillColor(NEUTRAL_LIGHT);
    const reasonLines = doc.splitTextToSize(data.otherEarningReason || "No reason given.", contentW - 30);
    const boxH = Math.max(9, 4 + reasonLines.length * 4);
    doc.rect(marginX, y - 4.5, contentW, boxH, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(ACCENT_DARK);
    doc.text(data.otherEarningAmountLabel, marginX + 4, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(TEXT);
    doc.text(reasonLines, marginX + 28, y - 1);

    y += boxH + 2;
  }

  if (data.multiLocation && data.locationBreakdown.length) {
    y += 2;
    doc.setDrawColor(DIVIDER);
    doc.line(marginX, y, pageW - marginX, y);
    y += 6;
    doc.setFillColor(NEUTRAL_LIGHT);
    doc.rect(marginX, y - 4, contentW, 8, "F");
    doc.setFontSize(8);
    let lx = marginX + 3;
    data.locationBreakdown.forEach((lb) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(TEXT);
      doc.text(lb.location, lx, y);
      const w1 = doc.getTextWidth(lb.location);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(MUTED);
      const rest = `  —  ${lb.hoursLabel} · ${lb.moneyLabel}`;
      doc.text(rest, lx + w1, y);
      lx += w1 + doc.getTextWidth(rest) + 10;
    });
    y += 8;
  }

  y += 3;
  doc.setDrawColor(TEXT);
  doc.setLineWidth(0.8);
  doc.line(marginX, y, pageW - marginX, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(TEXT);
  doc.text("Total", marginX, y);
  doc.setTextColor(ACCENT_DARK);
  doc.text(`${fmt2(data.totalHours)}h · ${data.currency}${data.totalEarnings.toFixed(2)}`, pageW - marginX, y, { align: "right" });
  if (data.totalFuelCost > 0 || data.otherEarningAmount > 0) {
    y += 4.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED);
    const parts = [
      data.totalFuelCost > 0 ? `${data.totalFuelCostLabel} fuel cost` : null,
      data.otherEarningAmount > 0 ? `${data.otherEarningAmountLabel} other earnings` : null,
    ].filter(Boolean);
    doc.text(`Includes ${parts.join(" + ")}`, pageW - marginX, y, { align: "right" });
  }

  // — footer: a subtle highlighted band carrying the report attribution and,
  // below it, a small credit row with drawn GitHub/globe marks that link out.
  doc.setFillColor(NEUTRAL_LIGHT);
  doc.rect(0, pageH - 15, pageW, 15, "F");
  doc.setDrawColor(DIVIDER);
  doc.setLineWidth(0.3);
  doc.line(0, pageH - 15, pageW, pageH - 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(`Generated by Wage Tracker · ${data.generatedOnLabel}`, marginX, pageH - 9.5);

  const creditY = pageH - 4.3;
  const badgeR = 1.4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(TEXT);
  let cx = marginX;
  const namePrefix = "Built by Ezaz Ahmad";
  doc.text(namePrefix, cx, creditY);
  cx += doc.getTextWidth(namePrefix) + 4.5;

  // GitHub badge + label, both clickable
  const ghStart = cx;
  drawGithubMark(doc, cx + badgeR, creditY - 1, badgeR, DARK_AVATAR);
  cx += badgeR * 2 + 1.6;
  doc.setTextColor(ACCENT_DARK);
  doc.text("GitHub", cx, creditY);
  const ghLabelW = doc.getTextWidth("GitHub");
  doc.link(ghStart - 0.6, creditY - 3, cx - ghStart + ghLabelW + 1.2, 4, { url: "https://github.com/Ezaz-Ahmad" });
  cx += ghLabelW + 5;

  // Portfolio badge + label, both clickable
  const pfStart = cx;
  drawGlobeMark(doc, cx + badgeR, creditY - 1, badgeR, ACCENT_DARK);
  cx += badgeR * 2 + 1.6;
  doc.setTextColor(ACCENT_DARK);
  doc.text("Portfolio", cx, creditY);
  const pfLabelW = doc.getTextWidth("Portfolio");
  doc.link(pfStart - 0.6, creditY - 3, cx - pfStart + pfLabelW + 1.2, 4, { url: "https://ezazahmad.com" });

  const namePart = (data.employeeName || "employee")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  const rangePart = data.weekRangeLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const filename = `${namePart}-wages-report-${rangePart}.pdf`;
  doc.save(filename);
}
