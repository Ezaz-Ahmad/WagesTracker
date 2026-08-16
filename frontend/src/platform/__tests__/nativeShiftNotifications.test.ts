// Unit tests for the native shift-notification adapter's translation layer,
// mirroring nativeBiometricAuth.test.ts's approach: mock the raw plugin port
// directly rather than requiring an actual native runtime (there is none in
// this sandbox — see ios-simulator.yml for the real Simulator compile).
// What's under test here is entirely the JS-side translation from the
// plugin's raw resolve/reject shape into the typed ShiftNotificationAdapter
// contract AppContext/useTodayShift consume — plus, critically, that a
// native failure of any kind is swallowed rather than propagated: posting a
// notification must never be allowed to interrupt a shift actually
// starting/ending (see useTodayShift.ts).
import { describe, expect, it, vi } from "vitest";
import { NativeShiftNotificationAdapter, type ShiftNotificationPluginPort } from "../nativeShiftNotifications";

function fakePlugin(overrides: Partial<ShiftNotificationPluginPort> = {}): ShiftNotificationPluginPort {
  return {
    postShiftStarted: vi.fn(async () => {}),
    clearShiftNotification: vi.fn(async () => {}),
    getPendingEndShift: vi.fn(async () => ({ hasPending: false })),
    clearPendingEndShift: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("NativeShiftNotificationAdapter", () => {
  describe("postShiftStarted", () => {
    it("forwards the info straight through to the plugin", async () => {
      const postShiftStarted = vi.fn(async () => {});
      const adapter = new NativeShiftNotificationAdapter(fakePlugin({ postShiftStarted }));
      const info = { shiftId: "s1", apiBaseUrl: "https://example.com", token: "t", startedAtLabel: "Started at 8:45 AM" };

      const result = await adapter.postShiftStarted(info);

      expect(postShiftStarted).toHaveBeenCalledWith(info);
      expect(result).toEqual({ ok: true });
    });

    it("is best-effort — a native failure (e.g. permission denied) never throws, but is reported in the result", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const plugin = fakePlugin({
        postShiftStarted: vi.fn(async () => {
          throw new Error("notifications denied");
        }),
      });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(
        adapter.postShiftStarted({ shiftId: "s1", apiBaseUrl: "https://example.com", token: "t", startedAtLabel: "x" }),
      ).resolves.toEqual({ ok: false, error: "notifications denied" });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("falls back to String(error) when the platform throws something that isn't an Error", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const plugin = fakePlugin({
        // Capacitor plugin rejections are always real Error objects in
        // practice, but this guards the fallback path itself rather than
        // assuming that never changes.
        postShiftStarted: vi.fn(async () => {
          throw "notifications denied";
        }),
      });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(
        adapter.postShiftStarted({ shiftId: "s1", apiBaseUrl: "https://example.com", token: "t", startedAtLabel: "x" }),
      ).resolves.toEqual({ ok: false, error: "notifications denied" });
      consoleError.mockRestore();
    });
  });

  describe("clearShiftNotification", () => {
    it("calls through to the plugin", async () => {
      const clearShiftNotification = vi.fn(async () => {});
      const adapter = new NativeShiftNotificationAdapter(fakePlugin({ clearShiftNotification }));
      await adapter.clearShiftNotification();
      expect(clearShiftNotification).toHaveBeenCalledOnce();
    });

    it("is best-effort — a native failure never throws", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const plugin = fakePlugin({
        clearShiftNotification: vi.fn(async () => {
          throw new Error("no notification posted");
        }),
      });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(adapter.clearShiftNotification()).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("getPendingEndShift", () => {
    it("translates hasPending: true with a full record into a PendingEndShift", async () => {
      const plugin = fakePlugin({
        getPendingEndShift: vi.fn(async () => ({ hasPending: true, shiftId: "s1", signOut: "17:00:00" })),
      });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(adapter.getPendingEndShift()).resolves.toEqual({ shiftId: "s1", signOut: "17:00:00" });
    });

    it("translates hasPending: false into null", async () => {
      const plugin = fakePlugin({ getPendingEndShift: vi.fn(async () => ({ hasPending: false })) });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(adapter.getPendingEndShift()).resolves.toBeNull();
    });

    it("treats hasPending: true with a missing shiftId/signOut as nothing pending rather than a corrupt record", async () => {
      const plugin = fakePlugin({
        getPendingEndShift: vi.fn(async () => ({ hasPending: true }) as { hasPending: boolean; shiftId?: string; signOut?: string }),
      });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(adapter.getPendingEndShift()).resolves.toBeNull();
    });

    it("treats a native failure the same as nothing pending — never blocks app startup", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const plugin = fakePlugin({
        getPendingEndShift: vi.fn(async () => {
          throw new Error("keychain busy");
        }),
      });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(adapter.getPendingEndShift()).resolves.toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("clearPendingEndShift", () => {
    it("calls through to the plugin", async () => {
      const clearPendingEndShift = vi.fn(async () => {});
      const adapter = new NativeShiftNotificationAdapter(fakePlugin({ clearPendingEndShift }));
      await adapter.clearPendingEndShift();
      expect(clearPendingEndShift).toHaveBeenCalledOnce();
    });

    it("is best-effort — a native failure never throws", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const plugin = fakePlugin({
        clearPendingEndShift: vi.fn(async () => {
          throw new Error("no pending record");
        }),
      });
      const adapter = new NativeShiftNotificationAdapter(plugin);

      await expect(adapter.clearPendingEndShift()).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
