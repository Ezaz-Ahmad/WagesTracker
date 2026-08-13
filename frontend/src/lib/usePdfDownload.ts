import { useCallback, useEffect, useRef, useState } from "react";
import { generateReportPdf } from "../pdf/generateReportPdf";
import type { WeekReportData } from "./reportData";

// A real PDF (a handful of shifts, no page breaks) can generate in well
// under 100ms — fast enough that a loading indicator would just flash and
// vanish, which reads as a glitch rather than a smooth transition. Holding
// the "preparing" state open to at least this long makes the button always
// go through one deliberate, visible motion (busy -> confirmed) instead of
// sometimes skipping straight to the end.
const MIN_VISIBLE_MS = 500;
// How long the "Downloaded ✓" confirmation stays up before the button
// settles back to its normal label.
const CONFIRM_MS = 1600;

/**
 * Wraps generateReportPdf with error handling, a minimum-duration busy
 * state, and a brief success confirmation — turning what used to be an
 * instant, silent download into three clear, smooth stages: preparing,
 * confirmed, back to normal. Also catches failure: the two "Download PDF"
 * buttons used to call this with `void generateReportPdf(...)` and no catch,
 * so any failure (a blocked download, a jsPDF quirk) meant the button did
 * nothing with zero feedback.
 */
export function usePdfDownload() {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [justDownloaded, setJustDownloaded] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const download = useCallback(async (data: WeekReportData) => {
    setError(null);
    setJustDownloaded(false);
    clearTimeout(confirmTimer.current);
    setDownloading(true);
    const startedAt = Date.now();
    try {
      await generateReportPdf(data);
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_VISIBLE_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_VISIBLE_MS - elapsed));
      }
      setJustDownloaded(true);
      confirmTimer.current = setTimeout(() => setJustDownloaded(false), CONFIRM_MS);
    } catch (e) {
      // Deliberately NOT `e.message`. Every failure reachable here is
      // internal to PDF generation — a jsPDF quirk, a blocked download, an
      // unexpected shape in the data — and those messages are stack-adjacent
      // implementation detail ("Cannot read properties of undefined
      // (reading 'x')"). Showing them tells the user nothing they can act on
      // and exposes internals in a screenshot they might share. The detail
      // still goes to the console, where it is useful for diagnosis.
      //
      // This differs from the shift-editing path on purpose: there the
      // server's message is genuinely actionable ("that overlaps another
      // shift you've already logged") and is shown verbatim.
      console.error("PDF generation failed:", e);
      setError("Couldn't generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  }, []);

  return { download, downloading, justDownloaded, error, clearError: () => setError(null) };
}
