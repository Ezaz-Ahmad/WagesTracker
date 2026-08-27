import type { EmailMessage } from "./transport.js";

const BRAND = {
  accent: "#ec3013",
  accentDark: "#ae1800",
  text: "#201e1d",
  muted: "#605d5d",
  background: "#f6f4f3",
  surface: "#fffdfc",
  border: "#eae7e7",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function greeting(name: string): string {
  const firstName = name.trim().split(/\s+/)[0];
  return firstName ? `Hi ${firstName},` : "Hi,";
}

interface EmailLayout {
  heading: string;
  intro: string;
  paragraphs: string[];
  footnote: string;
  buttonLabel?: string;
  buttonUrl?: string;
}

function layout(input: EmailLayout): string {
  const paragraphs = input.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.text};">${paragraph}</p>`)
    .join("");
  const button = input.buttonLabel && input.buttonUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td bgcolor="${BRAND.accent}" style="border-radius:10px;"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;padding:14px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#fff;text-decoration:none;border-radius:10px;">${escapeHtml(input.buttonLabel)}</a></td></tr></table><p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${BRAND.muted};">Button not working? Copy and paste this address into your browser:</p><p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(input.buttonUrl)}" style="color:${BRAND.accentDark};">${escapeHtml(input.buttonUrl)}</a></p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.background};"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.background};padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:16px;"><tr><td style="padding:28px 32px 8px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${BRAND.accent};font-size:15px;font-weight:800;">Wage&nbsp;Tracker</td></tr><tr><td style="padding:0 32px 32px;font-family:Segoe UI,Helvetica,Arial,sans-serif;"><h1 style="margin:8px 0 16px;font-size:22px;line-height:1.3;color:${BRAND.text};">${escapeHtml(input.heading)}</h1>${paragraphs}${button}<hr style="border:0;border-top:1px solid ${BRAND.border};margin:8px 0 16px;"><p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">${input.footnote}</p></td></tr></table>
<p style="max-width:560px;margin:16px auto 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:${BRAND.muted};text-align:center;">This is an automated message from Wage Tracker. Please don't reply to it.</p>
</td></tr></table></body></html>`;
}

export function passwordResetEmail(input: {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): EmailMessage {
  const heading = "Reset your Wage Tracker password";
  return {
    to: input.to,
    subject: heading,
    tag: "password-reset",
    html: layout({
      heading,
      intro: `Use this link within ${input.expiresInMinutes} minutes to choose a new password.`,
      paragraphs: [
        escapeHtml(greeting(input.name)),
        "We received a request to reset the password for your Wage Tracker account.",
      ],
      buttonLabel: "Choose a new password",
      buttonUrl: input.resetUrl,
      footnote: `This link works once and expires in ${input.expiresInMinutes} minutes. If you didn't request it, you can safely ignore this email; your current password remains unchanged.`,
    }),
    text: [
      greeting(input.name),
      "",
      "We received a request to reset the password for your Wage Tracker account.",
      "Open this link to choose a new password:",
      "",
      input.resetUrl,
      "",
      `This link works once and expires in ${input.expiresInMinutes} minutes.`,
      "If you didn't request it, you can safely ignore this email; your current password remains unchanged.",
      "",
      "— Wage Tracker",
    ].join("\n"),
  };
}

export function passwordChangedEmail(input: { to: string; name: string; supportUrl: string }): EmailMessage {
  const heading = "Your Wage Tracker password was changed";
  return {
    to: input.to,
    subject: heading,
    tag: "password-changed",
    html: layout({
      heading,
      intro: "Every signed-in device has been signed out.",
      paragraphs: [
        escapeHtml(greeting(input.name)),
        "The password on your Wage Tracker account was changed, and every signed-in device was signed out.",
        "If this was you, there is nothing else to do—just sign in again with your new password.",
      ],
      footnote: `If this wasn't you, secure your email account, reset your Wage Tracker password again immediately, and contact support: <a href="${escapeHtml(input.supportUrl)}" style="color:${BRAND.accentDark};">${escapeHtml(input.supportUrl)}</a>`,
    }),
    text: [
      greeting(input.name),
      "",
      "The password on your Wage Tracker account was changed, and every signed-in device was signed out.",
      "If this was you, there is nothing else to do—just sign in again with your new password.",
      "",
      "If this wasn't you, secure your email account, reset your password again immediately, and contact support:",
      input.supportUrl,
      "",
      "— Wage Tracker",
    ].join("\n"),
  };
}
