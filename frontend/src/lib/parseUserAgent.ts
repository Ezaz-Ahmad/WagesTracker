const MAX_LABEL_LENGTH = 60;

/**
 * Turns a stored session's raw `User-Agent` string into a short, friendly
 * device label ("Chrome on macOS") for the Security & Sessions list —
 * parsed entirely locally with a handful of substring checks, never sent
 * anywhere or looked up against an external service. Anything that doesn't
 * look like a browser UA string (including the empty string, or a value
 * that's already a friendly label) is returned as-is, just capped in length
 * so a pathologically long or garbled value can never blow out the card
 * layout.
 */
export function parseDeviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "Unknown device";

  // iPhone/iPad/iPod must be checked *before* macOS — nearly every iOS
  // Safari/WebKit UA string also contains "like Mac OS X" (WebKit's
  // historical compatibility token), so checking macOS first misreported
  // every iPhone session as "on macOS".
  let os: string | null = null;
  if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  // On iOS, every third-party browser is really Safari/WebKit underneath
  // and Apple requires it to say so — Chrome uses "CriOS/", Firefox uses
  // "FxiOS/", Edge uses "EdgiOS/", all *in addition to* a plain "Safari/"
  // token later in the string. Checking for these first is what lets a
  // plain "Safari/" (with none of the iOS in-app-browser tokens present)
  // correctly mean actual Safari, on iOS or anywhere else.
  let browser: string | null = null;
  if (/CriOS\//i.test(ua)) browser = "Chrome";
  else if (/FxiOS\//i.test(ua)) browser = "Firefox";
  else if (/EdgiOS\//i.test(ua)) browser = "Edge";
  else if (/EdgA?\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;

  if (ua.length > MAX_LABEL_LENGTH) return `${ua.slice(0, MAX_LABEL_LENGTH - 1)}…`;
  return ua;
}
