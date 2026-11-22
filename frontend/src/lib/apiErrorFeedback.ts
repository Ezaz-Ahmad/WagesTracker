import type { ErrorFeedback } from "./errorFeedback";
import type { ShiftConflict } from "./shiftConflict";

interface Failure { message: string; status: number; code?: string; field?: string; suggestion?: string; conflict?: ShiftConflict }

/** Explain the cause and a relevant next step. HTTP conflicts, sign-in
 * failures and service problems should never share a "fix this field" CTA. */
export function feedbackForApiError(error: Failure): ErrorFeedback {
  const { message, status, code, field, suggestion, conflict } = error;
  const base: ErrorFeedback = { message, field, suggestion, tone: "warning", actionLabel: field ? "Review field" : "Got it" };
  if (conflict) return { ...base, conflict, title: conflict.kind === "running" ? "A shift is still running" : "These shifts overlap", message: conflict.kind === "running" ? "Finish or correct your running shift before starting another." : "Your change uses time already recorded in a saved shift.", hint: conflict.kind === "running" ? "Check the running job on Home, or correct its times in History." : "Check AM/PM. Adjust these times or correct the saved shift in History.", actionLabel: "Review times" };
  if (code === "SHIFT_OVERLAP" || /overlaps? another shift|shift overlaps/i.test(message)) return { ...base, title: "These shifts overlap", hint: "Check the saved shift in History, including its date and AM/PM times.", actionLabel: "Review times" };
  if (code === "OPEN_SHIFT_EXISTS" || /already have an open shift/i.test(message)) return { ...base, title: "A shift is still running", hint: "Finish that shift on Home, or correct its times in History.", actionLabel: "Review shift" };
  if (code === "REQUEST_TIMEOUT") return { ...base, tone: "info", title: /confirm the result/i.test(message) ? "Check whether it saved" : "Taking longer than expected", hint: /confirm the result/i.test(message) ? "Refresh this view before trying again to avoid saving twice." : "Check your connection and try again in a moment." };
  if (status === 0) return { ...base, tone: "info", title: "Connection interrupted", hint: "Check Wi-Fi or mobile data, then try again." };
  if (status === 401) return { ...base, title: /expired|log in again/i.test(message) ? "Sign in again" : /current password/i.test(message) ? "Check your current password" : "Check your sign-in details", hint: /expired|log in again/i.test(message) ? "Sign in with your current email and password to continue." : /current password/i.test(message) ? "Use the password you currently sign in with." : "Check your email and password, then try again.", actionLabel: /expired|log in again/i.test(message) ? "Back to sign-in" : /current password/i.test(message) ? "Review password" : "Review sign-in" };
  if (status === 403) return { ...base, title: "Access not available", hint: "Check which account you're using. Contact support if you need help." };
  if (status === 404) return { ...base, tone: "info", title: "Record no longer available", hint: "Refresh this view to see the latest records." };
  if (status === 429) return { ...base, title: "Please wait a moment", hint: "Wait a few minutes before trying again." };
  if (code === "INVALID_RESPONSE" || status >= 500) return { ...base, tone: "info", title: "Service temporarily unavailable", hint: "Try again in a moment. If it continues, contact support." };
  if (/email.*(?:already|in use|registered)/i.test(message)) return { ...base, title: "Email already in use", hint: "Use another address, or sign in with this email." };
  if (/changed on another device|refresh.*before saving/i.test(message)) return { ...base, title: "This record has changed", hint: "Refresh to review the latest details before editing again." };
  if (/sign-in and sign-out|sign.?in|sign.?out|shift.*time/i.test(message)) return { ...base, title: "Check the shift times", hint: "Check the start, finish and AM/PM. Overnight shifts end on the following day.", actionLabel: "Review times" };
  if (code === "INVALID_CLIENT_TIME_ZONE" || /future date|valid date|calendar date/i.test(message)) return { ...base, title: code === "INVALID_CLIENT_TIME_ZONE" ? "Check your device time zone" : "Check the date", actionLabel: "Review date" };
  if (/work location/i.test(message)) return { ...base, title: "Check the work location", actionLabel: "Review location" };
  if (/password/i.test(message)) return { ...base, title: "Check the password", actionLabel: "Review password" };
  if (/email|domain/i.test(message)) return { ...base, title: "Check the email", actionLabel: "Review email" };
  if (/amount|hourly rate|decimal/i.test(message)) return { ...base, title: "Check the amount", actionLabel: "Review amount" };
  return { ...base, title: status === 409 ? "Review this change" : "Check these details", actionLabel: "Review details" };
}
