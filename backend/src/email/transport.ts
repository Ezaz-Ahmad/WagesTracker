/** Provider-neutral transactional email delivery. Provider credentials are
 * read only on the backend and are never returned to a browser or app. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag?: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export class ResendTransport implements EmailTransport {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo?: string
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(this.replyTo ? { reply_to: this.replyTo } : {}),
          ...(message.tag ? { tags: [{ name: "category", value: message.tag }] } : {}),
        }),
      });
    } catch {
      // Do not place the recipient, subject, provider response body, or reset
      // URL in an exception that will eventually reach an application log.
      throw new Error("The mail provider could not be reached.");
    }

    if (!response.ok) {
      const requestId = response.headers.get("x-request-id");
      throw new Error(
        `The mail provider rejected the request (HTTP ${response.status}${requestId ? `, request ${requestId}` : ""}).`
      );
    }
  }
}

/** Local-only transport: makes the full flow testable without an email
 * account. It is categorically refused in production because it prints the
 * raw reset URL. */
export class ConsoleTransport implements EmailTransport {
  readonly name = "console";

  async send(message: EmailMessage): Promise<void> {
    console.info(
      [
        "",
        "-------- Wage Tracker development email --------",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "------------------------------------------------",
        "",
      ].join("\n")
    );
  }
}

export class MemoryTransport implements EmailTransport {
  readonly name = "memory";
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
  }
}

export const testOutbox = new MemoryTransport();

let cachedTransport: EmailTransport | null | undefined;

export function createTransport(): EmailTransport | null {
  const environment = process.env.NODE_ENV;
  const explicitProvider = process.env.MAIL_PROVIDER?.trim().toLowerCase() || "";

  if (environment === "test" && (!explicitProvider || explicitProvider === "memory")) return testOutbox;

  if (explicitProvider === "console") {
    if (environment === "production") return null;
    return new ConsoleTransport();
  }

  // Memory delivery outside a test would silently discard real mail.
  if (explicitProvider === "memory") return null;
  if (explicitProvider && explicitProvider !== "resend") return null;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (apiKey && from) {
    return new ResendTransport(apiKey, from, process.env.MAIL_REPLY_TO?.trim() || undefined);
  }

  return environment === "production" ? null : new ConsoleTransport();
}

export function getTransport(): EmailTransport | null {
  if (cachedTransport === undefined) cachedTransport = createTransport();
  return cachedTransport;
}

export function resetTransportForTests(): void {
  cachedTransport = undefined;
  testOutbox.outbox.length = 0;
}
