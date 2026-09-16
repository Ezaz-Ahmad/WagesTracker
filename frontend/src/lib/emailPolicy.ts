const COMMON_DOMAIN_CORRECTIONS: Readonly<Record<string, string>> = {
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmal.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "hmail.com": "gmail.com",
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

const COMMON_PROVIDER_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "yahoo.com",
] as const;

// These are real public email providers that happen to be one character away
// from gmail.com. Do not turn a useful typo warning into a false alarm.
const KNOWN_VALID_NEARBY_DOMAINS = new Set(["email.com", "mail.com", "ymail.com"]);

function isSingleEditAway(value: string, candidate: string): boolean {
  const lengthDifference = Math.abs(value.length - candidate.length);
  if (lengthDifference > 1 || value === candidate) return false;

  if (value.length === candidate.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] !== candidate[index]) mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    if (mismatches.length !== 2) return false;
    const [first, second] = mismatches;
    return second === first + 1 && value[first] === candidate[second] && value[second] === candidate[first];
  }

  const shorter = value.length < candidate.length ? value : candidate;
  const longer = value.length < candidate.length ? candidate : value;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

function suggestDomainCorrection(domain: string): string | undefined {
  const explicitCorrection = COMMON_DOMAIN_CORRECTIONS[domain];
  if (explicitCorrection) return explicitCorrection;
  if (KNOWN_VALID_NEARBY_DOMAINS.has(domain)) return undefined;

  const likelyProviders = COMMON_PROVIDER_DOMAINS.filter((provider) => isSingleEditAway(domain, provider));
  return likelyProviders.length === 1 ? likelyProviders[0] : undefined;
}

export interface EmailValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
  suggestion?: string;
}
/** Fast UI mirror of the authoritative backend policy. It checks the address
 * shape and flags likely typing errors without changing the user's input. */
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
  const correctedDomain = suggestDomainCorrection(domain);
  return { valid: true, normalized, ...(correctedDomain ? { suggestion: `${local}@${correctedDomain}` } : {}) };
}
