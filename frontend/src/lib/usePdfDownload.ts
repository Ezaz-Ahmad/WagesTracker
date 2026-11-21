import { alignExtrasToWeek } from "./pay";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateReportPdf } from "../pdf/generateReportPdf";
import * as api from "./api";
import { buildWeekDays, isoDate } from "./date";
import { buildWeekReportData } from "./reportData";
import type { User } from "./types";

export interface PdfDownloadRequest {
  user: User;
  today: Date;
  currency: string;
  /** Any date inside the requested week. Omit for the current week. */
  weekAnchor?: Date;
  /** Explicit export scope avoids changing the user's current workspace. */
  jobScope?: string;
}

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
 * Fetches the requested week's latest data, then wraps generateReportPdf
 * with error handling, a minimum-duration busy
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
  const inFlight = useRef(false);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const download = useCallback(async ({ user, today, currency, weekAnchor, jobScope }: PdfDownloadRequest) => {
    // The disabled button is the visible guard, but state updates do not
    // happen synchronously. This ref also prevents two rapid calls in the
    // same render frame from starting duplicate fetches/downloads.
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setJustDownloaded(false);
    clearTimeout(confirmTimer.current);
    setDownloading(true);
    const startedAt = Date.now();
    const scope=jobScope??api.getJobScope()??undefined;
    try {
      const anchor = weekAnchor ?? today;
      const weekDays = buildWeekDays(anchor, user.weekStartsOn);
      const from = isoDate(weekDays[0]);
      const to = isoDate(weekDays[6]);
      const [{ shifts }, { expenses }, { extras }] = await Promise.all([
        scope?api.listShifts(from,to,scope):api.listShifts(from,to),
        scope?api.listDayExpenses(from,to,scope):api.listDayExpenses(from,to),
        scope?api.listWeekExtras(from,to,scope):api.listWeekExtras(from,to),
      ]);
      const reportUser=scope==="all"?{...user,workLocationName:"All jobs · personal summary",multipleLocations:true}:user;
      const data = buildWeekReportData(reportUser, shifts, today, currency, expenses, scope==="all"?alignExtrasToWeek(extras,"Monday"):extras, { weekAnchor: anchor });
      await generateReportPdf(data);
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_VISIBLE_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_VISIBLE_MS - elapsed));
      }
      setJustDownloaded(true);
      confirmTimer.current = setTimeout(() => setJustDownloaded(false), CONFIRM_MS);
    } catch (e) {
      // Deliberately NOT `e.message`: this path includes both API refresh
      // failures and PDF-library/browser failures, whose raw messages can be
      // implementation detail. The safe copy offers the useful next action;
      // the exact error stays in the console for diagnosis.
      console.error("PDF download failed:", e);
      setError("Couldn't prepare the PDF. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setDownloading(false);
    }
  }, []);

  return { download, downloading, justDownloaded, error, clearError: () => setError(null) };
}
