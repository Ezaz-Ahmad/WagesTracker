import { appBaseUrl, passwordResetUrl, supportUrl } from "../config/appUrls.js";
import { passwordChangedEmail, passwordResetEmail } from "./templates.js";
import { getTransport } from "./transport.js";

export const PASSWORD_RESET_TTL_MS = 25 * 60 * 1000;

export function isPasswordRecoveryConfigured(): boolean {
  return getTransport() !== null && appBaseUrl() !== null;
}

function transportOrThrow() {
  const transport = getTransport();
  if (!transport) throw new Error("Email delivery is not configured.");
  return transport;
}

export async function sendPasswordResetEmail(input: { to: string; name: string; rawToken: string }): Promise<void> {
  await transportOrThrow().send(
    passwordResetEmail({
      to: input.to,
      name: input.name,
      resetUrl: passwordResetUrl(input.rawToken),
      expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60_000),
    })
  );
}

export async function sendPasswordChangedEmail(input: { to: string; name: string }): Promise<void> {
  await transportOrThrow().send(passwordChangedEmail({ to: input.to, name: input.name, supportUrl: supportUrl() }));
}

export function sendNotificationBestEffort(operation: string, send: () => Promise<void>): void {
  void send().catch(() => {
    // No recipient, subject, provider response, or token is included.
    console.error(`[email] ${operation} notification could not be delivered.`);
  });
}

export function warnIfPasswordRecoveryUnconfigured(): void {
  if (process.env.NODE_ENV === "production" && !getTransport()) {
    console.warn("[warn] Password recovery email is unavailable. Set RESEND_API_KEY and MAIL_FROM.");
  }
  if (process.env.NODE_ENV === "production" && !appBaseUrl()) {
    console.warn("[warn] Password recovery links are unavailable. Set APP_BASE_URL to the frontend HTTPS origin.");
  }
  if (process.env.NODE_ENV !== "production" && getTransport()?.name === "console") {
    console.warn("[warn] Password recovery emails are being printed to the development console, not delivered.");
  }
}
