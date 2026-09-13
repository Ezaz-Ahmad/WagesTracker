const COMMON_DOMAIN_CORRECTIONS: Readonly<Record<string, string>> = {
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmal.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "googlemail.co": "googlemail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "hotnail.com": "hotmail.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "outlok.com": "outlook.com",
  "icloud.co": "icloud.com",
  "icloud.con": "icloud.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "yaho.com": "yahoo.com",
};

export interface EmailValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
  suggestion?: string;
}
/** Fast UI mirror of the authoritative backend policy. A valid shape is not
 * treated as proof of ownership; the emailed link provides that proof. */
export function validateEmailAddress(raw: string): EmailValidationResult {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return { valid: false, normalized, error: "Email is required" };
  if (normalized.length > 254) return { valid: false, normalized, error: "Email must be 254 characters or fewer" };
  if (/\s/u.test(normalized)) return { valid: false, normalized, error: "Email cannot contain spaces" };

  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, normalized, error: "Enter an email in the format name@example.com" };
  }
  const [local, domain] = parts;
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { valid: false, normalized, error: "Check the part of the email before @" };
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu.test(local)) {
    return { valid: false, normalized, error: "The email contains a character that isn't supported" };
  }
  const labels = domain.split(".");
  const domainValid = domain.length <= 253 && labels.length >= 2 && labels.every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label)
  ) && /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/iu.test(labels.at(-1) ?? "");
  if (!domainValid) {
    return { valid: false, normalized, error: "Check the email domain after @ (for example, example.com)" };
  }
  const correctedDomain = COMMON_DOMAIN_CORRECTIONS[domain];
  return { valid: true, normalized, ...(correctedDomain ? { suggestion: `${local}@${correctedDomain}` } : {}) };
}
