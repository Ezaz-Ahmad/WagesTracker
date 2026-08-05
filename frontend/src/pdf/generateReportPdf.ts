import type { WeekReportData } from "../lib/reportData";

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
  const locLine = [data.workLocationName, data.workAddress].filter(Boolean).join(" · ") || "—";
  doc.text(locLine, marginX + 13, y + 2.5);

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
    { label: "TOTAL HOURS", value: `${data.totalHours}h`, color: TEXT },
    { label: "TOTAL EARNINGS", value: `${data.currency}${data.totalEarnings.toFixed(2)}`, color: ACCENT_DARK },
    { label: "HOURLY RATE", value: `${data.currency}${data.rate}`, color: TEXT },
    { label: "DAYS WORKED", value: `${data.daysLogged} / 7`, color: TEXT },
  ];
  const tileW = contentW / 4;
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
  doc.text(`Avg. hours/day  ${data.avgHoursPerDayLabel}`, marginX, y);
  doc.text(`Avg. per shift  ${data.avgEarningsPerDayLabel}`, marginX + contentW / 3, y);
  doc.text(`Worked at  ${data.locationsCountLabel}`, marginX + (contentW / 3) * 2, y);

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
  });

  y += 8;
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
  doc.text(`${data.totalHours}h · ${data.currency}${data.totalEarnings.toFixed(2)}`, pageW - marginX, y, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(`Generated by Wage Tracker · ${data.generatedOnLabel}`, marginX, pageH - 10);

  let creditX = marginX;
  const creditPrefix = "Built by Ezaz Ahmad · ";
  doc.text(creditPrefix, creditX, pageH - 6);
  creditX += doc.getTextWidth(creditPrefix);
  doc.textWithLink("github.com/Ezaz-Ahmad", creditX, pageH - 6, { url: "https://github.com/Ezaz-Ahmad" });
  creditX += doc.getTextWidth("github.com/Ezaz-Ahmad");
  doc.text(" · ", creditX, pageH - 6);
  creditX += doc.getTextWidth(" · ");
  doc.textWithLink("ezazahmad.com", creditX, pageH - 6, { url: "https://ezazahmad.com" });

  const filename = `wage-report-${data.weekRangeLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  doc.save(filename);
}
