const FRIENDLY_EXACT_MESSAGES: Readonly<Record<string, string>> = {
  "Invalid input": "Check the information you entered and try again.",
  "No fields to update": "Make at least one change before saving.",
  "At least one change is required": "Make at least one change before saving.",
  "Invalid or expired token": "Your sign-in has expired. Please log in again.",
  "Missing or invalid Authorization header": "Your sign-in has expired. Please log in again.",
  "Internal server error": "Something went wrong. Please try again.",
  "Origin not allowed": "Wage Tracker couldn't connect securely. Please try again later.",
  "Session not found": "That signed-in device is no longer listed. Refresh and try again.",
  "biometricProtected must be a boolean": "Couldn't update Face ID or Touch ID. Please try again.",
  "Invalid device installation id": "This device couldn't be recognised. Close and reopen Wage Tracker, then try again.",
  "Invalid or expired shift action token": "That shift shortcut has expired. Open Wage Tracker and try again.",
};

/**
 * Keeps implementation details from leaking into popups. Specific, useful
 * validation messages pass through unchanged; only developer-style fallbacks
 * and internal field names are replaced.
 */
export function toUserFacingError(message: string | undefined, status: number): string {
  const text = message?.trim() ?? "";
  const friendly = FRIENDLY_EXACT_MESSAGES[text];
  if (friendly) return friendly;
  if (/^Request failed \(\d+\)$/i.test(text)) return "Something went wrong. Please try again.";
  if (/^(?:date|weekStart) must be /i.test(text)) return "Choose a valid date and try again.";
  if (/^(?:Invalid|Expected) (?:uuid|string|number|boolean|date)/i.test(text)) {
    return "Check the information you entered and try again.";
  }
  if (!text) {
    return status >= 500
      ? "Something went wrong. Please try again."
      : "We couldn't complete that action. Check your details and try again.";
  }
  return text;
}
