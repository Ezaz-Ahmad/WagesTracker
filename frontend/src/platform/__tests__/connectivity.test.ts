import { describe, expect, it, vi } from "vitest";
import {
  configureConnectivityAdapter,
  getConnectivityStatus,
  subscribeConnectivity,
  type ConnectivityStatus,
} from "../connectivity";

describe("connectivity abstraction", () => {
  it("reports offline state, reconnection and removes the listener", async () => {
    let listener: ((status: ConnectivityStatus) => void) | undefined;
    const remove = vi.fn();
    configureConnectivityAdapter({
      getStatus: vi.fn(async () => ({ connected: false })),
      addListener: vi.fn(async (next) => { listener = next; return { remove }; }),
    });
    const statuses: boolean[] = [];
    const dispose = subscribeConnectivity((status) => statuses.push(status.connected));
    await Promise.resolve();
    await Promise.resolve();
    listener?.({ connected: true });
    dispose();

    expect(statuses).toEqual([false, true]);
    expect(remove).toHaveBeenCalledOnce();
    await expect(getConnectivityStatus()).resolves.toEqual({ connected: false });
  });

  it("cleans up a listener that resolves after Strict Mode disposal", async () => {
    let resolveHandle!: (value: { remove(): void }) => void;
    const remove = vi.fn();
    configureConnectivityAdapter({
      getStatus: async () => ({ connected: true }),
      addListener: () => new Promise((resolve) => { resolveHandle = resolve; }),
    });
    const dispose = subscribeConnectivity(vi.fn());
    dispose();
    resolveHandle({ remove });
    await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
  });
});
