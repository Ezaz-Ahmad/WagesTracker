export const APP_STORE_ID = 6801702467;
export const IOS_BUNDLE_ID = "com.ezazahmad.wagestracker";
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;

export interface AvailableAppUpdate {
  installedVersion: string;
  latestVersion: string;
}

export interface AppUpdateAdapter {
  lookup(): Promise<AvailableAppUpdate | null>;
}

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL = 15 * 60 * 1000;
const REMIND_INTERVAL = 48 * 60 * 60 * 1000;
const DISMISS_KEY = "wagesTracker.appUpdate.dismissed.v1";

/** App Store marketing versions are numeric, not lexical or build numbers. */
export function isNewerAppVersion(candidate: string, installed: string): boolean {
  const parse = (value: string) => {
    if (!/^\d+(?:\.\d+){0,2}$/.test(value)) return null;
    const parts = value.split(".").map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
  };
  const next = parse(candidate);
  const current = parse(installed);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index++) {
    const difference = (next[index] ?? 0) - (current[index] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

export class AppUpdateService {
  private inFlight: Promise<AvailableAppUpdate | null> | null = null;
  private checkedAt: number | null = null;
  private retryAt = 0;
  private cached: AvailableAppUpdate | null = null;
  private dismissed: { version: string; at: number } | null = null;

  constructor(
    private readonly adapter: AppUpdateAdapter,
    private readonly storage?: Pick<Storage, "getItem" | "setItem">,
    private readonly now: () => number = () => Date.now(),
  ) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(DISMISS_KEY) ?? "null");
      if (saved && typeof saved === "object" && "version" in saved && "at" in saved &&
          typeof saved.version === "string" && typeof saved.at === "number" && Number.isFinite(saved.at)) {
        this.dismissed = { version: saved.version, at: saved.at };
      }
    } catch { /* Storage is optional; updates must never block startup. */ }
  }

  async check(): Promise<AvailableAppUpdate | null> {
    if (this.inFlight) return this.inFlight;
    const now = this.now();
    const reminderDue = this.cached && this.dismissed && this.checkedAt !== null &&
      now >= this.dismissed.at + REMIND_INTERVAL && this.checkedAt < this.dismissed.at + REMIND_INTERVAL;
    if (!reminderDue && this.checkedAt !== null && now >= this.checkedAt && now - this.checkedAt < CHECK_INTERVAL) {
      return this.shouldOffer(this.cached);
    }
    if (now < this.retryAt) return null;
    this.inFlight = (async () => {
      try {
        const result = await this.adapter.lookup();
        this.cached = result && isNewerAppVersion(result.latestVersion, result.installedVersion) ? result : null;
        this.checkedAt = this.now();
        this.retryAt = 0;
        return this.shouldOffer(this.cached);
      } catch {
        this.retryAt = this.now() + RETRY_INTERVAL;
        return null;
      }
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  dismiss(version: string): void {
    this.dismissed = { version, at: this.now() };
    try { this.storage?.setItem(DISMISS_KEY, JSON.stringify(this.dismissed)); } catch { /* Memory fallback. */ }
  }

  /** Recheck while foregrounded, including the exact reminder deadline. */
  nextCheckDelay(): number {
    const now = this.now();
    const deadlines = [this.retryAt > now ? this.retryAt :
      this.checkedAt !== null ? this.checkedAt + CHECK_INTERVAL : now];
    if (this.cached && this.dismissed && this.dismissed.at + REMIND_INTERVAL > now) {
      deadlines.push(this.dismissed.at + REMIND_INTERVAL);
    }
    return Math.max(1, Math.min(...deadlines) - now);
  }

  private shouldOffer(update: AvailableAppUpdate | null): AvailableAppUpdate | null {
    if (!update) return null;
    const dismissed = this.dismissed;
    const elapsed = dismissed ? this.now() - dismissed.at : REMIND_INTERVAL;
    // Respect Not now for the full 48 hours, even if another release appears.
    return dismissed && elapsed >= 0 && elapsed < REMIND_INTERVAL ? null : update;
  }
}

// The web has its own deployment refresh. Only native iOS installs this adapter.
let service: AppUpdateService | null = null;

export function configureAppUpdates(adapter: AppUpdateAdapter): void {
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Unavailable storage is harmless. */ }
  service = new AppUpdateService(adapter, storage);
}

export function checkForAppUpdate(): Promise<AvailableAppUpdate | null> {
  return service?.check() ?? Promise.resolve(null);
}

export function dismissAppUpdate(version: string): void {
  service?.dismiss(version);
}

export function nextAppUpdateCheckDelay(): number | null {
  return service?.nextCheckDelay() ?? null;
}
