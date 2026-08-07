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
      setError(e instanceof Error ? e.message : "Couldn't generate the PDF. Try again.");
    } finally {
      setDownloading(false);
    }
  }, []);

  return { download, downloading, justDownloaded, error, clearError: () => setError(null) };
}
