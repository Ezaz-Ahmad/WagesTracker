export const AUTOMATIC_REFRESH_COOLDOWN_MS = 1_000;

/** Coalesces Network + App lifecycle signals that commonly arrive together
 * when iOS returns to the foreground. Manual pull-to-refresh does not use this
 * gate and therefore always remains immediately available. */
export class AutomaticRefreshGate {
  private inFlight: Promise<void> | null = null;
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  trigger(run: () => Promise<void>, now: number = Date.now()): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (now - this.lastStartedAt < AUTOMATIC_REFRESH_COOLDOWN_MS) return Promise.resolve();
    this.lastStartedAt = now;
    const pending = run().finally(() => {
      if (this.inFlight === pending) this.inFlight = null;
    });
    this.inFlight = pending;
    return pending;
  }
}
