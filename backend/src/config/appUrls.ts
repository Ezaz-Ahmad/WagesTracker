/**
 * Public URLs placed in transactional email.
 *
 * Reset links must point at the frontend, not the API. Development uses the
 * local Vite server; production deliberately requires an explicit HTTPS
 * origin so a typo cannot send a live reset token to localhost or over plain
 * HTTP.
 */
const DEVELOPMENT_APP_URL = "http://localhost:5173";

function normalizedConfiguredUrl(): string | null {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  if (!configured) return process.env.NODE_ENV === "production" ? null : DEVELOPMENT_APP_URL;

  try {
    const url = new URL(configured);
    const protocolAllowed = process.env.NODE_ENV === "production" ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol);
    if (!protocolAllowed || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function appBaseUrl(): string | null {
  return normalizedConfiguredUrl();
}

/**
 * The token is kept in the URL fragment. Fragments are not sent in the HTTP
 * request and are not included in Referer headers, so neither Vercel nor an
 * intermediary access log receives the raw credential while serving the
 * reset page.
 */
export function passwordResetUrl(token: string): string {
  const baseUrl = appBaseUrl();
  if (!baseUrl) throw new Error("APP_BASE_URL is not configured as a valid production HTTPS URL.");
  return `${baseUrl}/reset-password#token=${encodeURIComponent(token)}`;
}

export function supportUrl(): string {
  const baseUrl = appBaseUrl();
  if (!baseUrl) throw new Error("APP_BASE_URL is not configured as a valid production HTTPS URL.");
  return `${baseUrl}/support`;
}
