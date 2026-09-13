export const APP_ERROR_EVENT = "wage-tracker:error-popup";

export interface ErrorFeedback {
  title?: string;
  message: string;
  hint?: string;
  field?: string;
  suggestion?: string;
}
export function showErrorPopup(feedback: ErrorFeedback): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ErrorFeedback>(APP_ERROR_EVENT, { detail: feedback }));
}

export function errorHintForStatus(status: number): string {
  if (status === 0) return "Check your connection, then try the same action again.";
  if (status === 401) return "Check your current password or sign-in details and try again.";
  if (status === 409) return "Choose a different value, then submit again.";
  if (status >= 500) return "Nothing you entered was cleared. Wait a moment and try again.";
  return "Review the highlighted field, correct it, and submit again.";
}
