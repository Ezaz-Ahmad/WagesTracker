import type { ShiftConflict } from "./shiftConflict";

export const APP_ERROR_EVENT = "wage-tracker:error-popup";

export interface ErrorFeedback {
  title?: string;
  message: string;
  hint?: string;
  field?: string;
  suggestion?: string;
  actionLabel?: string;
  tone?: "warning" | "danger" | "info";
  conflict?: ShiftConflict;
}
export function showErrorPopup(feedback: ErrorFeedback): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ErrorFeedback>(APP_ERROR_EVENT, { detail: feedback }));
}
