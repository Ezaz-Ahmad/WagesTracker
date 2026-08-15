import { describe, expect, it, vi } from "vitest";
import { AUTOMATIC_REFRESH_COOLDOWN_MS, AutomaticRefreshGate } from "../automaticRefresh";

describe("automatic native refresh gate", () => {
  it("coalesces concurrent reconnect and resume refreshes", async () => {
    let finish!: () => void;
    const request = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const gate = new AutomaticRefreshGate();
    const reconnect = gate.trigger(request, 1_000);
    const resume = gate.trigger(request, 1_001);
    expect(request).toHaveBeenCalledOnce();
    expect(resume).toBe(reconnect);
    finish();
    await reconnect;
  });

  it("suppresses a just-completed duplicate but permits a later refresh", async () => {
    const request = vi.fn(async () => undefined);
    const gate = new AutomaticRefreshGate();
    await gate.trigger(request, 1_000);
    await gate.trigger(request, 1_100);
    await gate.trigger(request, 1_000 + AUTOMATIC_REFRESH_COOLDOWN_MS);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
