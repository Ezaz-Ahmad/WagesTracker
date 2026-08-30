import { describe, expect, it, vi } from "vitest";
import { NativeActiveShiftActivityAdapter, type ActiveShiftActivityPluginPort } from "../nativeActiveShiftActivity";

function plugin(overrides: Partial<ActiveShiftActivityPluginPort> = {}): ActiveShiftActivityPluginPort {
  return {
    startOrUpdate: vi.fn().mockResolvedValue({
      status: "active",
      pendingClockOut: false,
      completionNotifications: "authorized",
    }),
    dismiss: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    retryPendingClockOut: vi.fn().mockResolvedValue({ queued: true }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
    ...overrides,
  };
}

const info = {
  shiftId: "shift-1",
  apiBaseUrl: "https://api.example.com",
  clockOutToken: "scoped-token",
  startedAtEpochMs: 1_786_000_000_000,
  location: "Newcastle",
};

describe("NativeActiveShiftActivityAdapter", () => {
  it("forwards the complete, scoped Live Activity payload", async () => {
    const port = plugin();
    const adapter = new NativeActiveShiftActivityAdapter(port);
    await expect(adapter.startOrUpdate(info)).resolves.toMatchObject({ status: "active" });
    expect(port.startOrUpdate).toHaveBeenCalledWith(info);
  });

  it("contains native start failures so a successful shift is never rolled back", async () => {
    const adapter = new NativeActiveShiftActivityAdapter(plugin({
      startOrUpdate: vi.fn().mockRejectedValue(new Error("Live Activities disabled")),
    }));
    await expect(adapter.startOrUpdate(info)).resolves.toEqual({
      status: "failed",
      error: "Live Activities disabled",
    });
  });

  it("forwards final duration when ending and contains cleanup failures", async () => {
    const end = vi.fn().mockRejectedValue(new Error("already gone"));
    const adapter = new NativeActiveShiftActivityAdapter(plugin({ end }));
    await expect(adapter.end({ shiftId: "shift-1", finalDurationSeconds: 30_450 })).resolves.toBeUndefined();
    expect(end).toHaveBeenCalledWith({ shiftId: "shift-1", finalDurationSeconds: 30_450 });
  });

  it("contains dismissal failures without affecting the active shift", async () => {
    const dismiss = vi.fn().mockRejectedValue(new Error("already dismissed"));
    const adapter = new NativeActiveShiftActivityAdapter(plugin({ dismiss }));
    await expect(adapter.dismiss()).resolves.toBeUndefined();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("subscribes to native completion events and removes the listener", async () => {
    let nativeListener: ((event: { shiftId: string; finalDurationSeconds: number }) => void) | undefined;
    const remove = vi.fn().mockResolvedValue(undefined);
    const port = plugin({
      addListener: vi.fn().mockImplementation(async (_name, listener) => {
        nativeListener = listener;
        return { remove };
      }),
    });
    const listener = vi.fn();
    const unsubscribe = await new NativeActiveShiftActivityAdapter(port).subscribeEnded(listener);
    nativeListener?.({ shiftId: "shift-1", finalDurationSeconds: 3600 });
    expect(listener).toHaveBeenCalledWith({ shiftId: "shift-1", finalDurationSeconds: 3600 });
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
