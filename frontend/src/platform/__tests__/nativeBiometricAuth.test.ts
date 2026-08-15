// Unit tests for the native biometric adapter's translation layer, mirroring
// nativePdfDelivery.test.ts/nativeSecureTokenStorage.test.ts's approach: mock
// the raw plugin port directly rather than requiring an actual native
// runtime (there is none in this sandbox — see ios-simulator.yml for the
// real Simulator compile). What's under test here is entirely the JS-side
// translation from the plugin's raw resolve/reject shape into the typed
// BiometricAuthAdapter contract AppContext consumes.
import { describe, expect, it, vi } from "vitest";
import { NativeBiometricAuthAdapter, type BiometricAuthPluginPort } from "../nativeBiometricAuth";

function fakePlugin(overrides: Partial<BiometricAuthPluginPort> = {}): BiometricAuthPluginPort {
  return {
    capabilities: vi.fn(async () => ({ kind: "faceId" as const, enrolled: true })),
    isEnabled: vi.fn(async () => ({ enabled: false })),
    enable: vi.fn(async () => ({ kind: "faceId" as const })),
    authenticate: vi.fn(async () => ({ token: "recovered-token", accountId: "u1" })),
    disable: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Reproduces the shape Capacitor's iOS bridge gives a rejected plugin call
 * — `.message` plus the native `call.reject(message, code)`'s second
 * argument surfaced as `.code`. */
function pluginRejection(code: string, message = "native failure") {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe("NativeBiometricAuthAdapter", () => {
  it("passes capabilities() straight through", async () => {
    const plugin = fakePlugin({
      capabilities: vi.fn(async () => ({ kind: "touchId" as const, enrolled: false, reason: "not set up" })),
    });
    const adapter = new NativeBiometricAuthAdapter(plugin);
    await expect(adapter.checkCapabilities()).resolves.toEqual({
      kind: "touchId",
      enrolled: false,
      reason: "not set up",
    });
  });

  it("passes getStatus() straight through", async () => {
    const plugin = fakePlugin({
      isEnabled: vi.fn(async () => ({ enabled: true, accountId: "u1", accountLabel: "Sam", kind: "faceId" as const })),
    });
    const adapter = new NativeBiometricAuthAdapter(plugin);
    await expect(adapter.getStatus()).resolves.toEqual({
      enabled: true,
      accountId: "u1",
      accountLabel: "Sam",
      kind: "faceId",
    });
  });

  describe("enable", () => {
    it("forwards accountId/accountLabel/token and reports the enabled kind on success", async () => {
      const enable = vi.fn(async () => ({ kind: "faceId" as const }));
      const plugin = fakePlugin({ enable });
      const adapter = new NativeBiometricAuthAdapter(plugin);

      const result = await adapter.enable("u1", "Sam Lee", "session-token");

      expect(enable).toHaveBeenCalledWith({ accountId: "u1", accountLabel: "Sam Lee", token: "session-token" });
      expect(result).toEqual({ outcome: "enabled", kind: "faceId" });
    });

    it("never throws — a cancelled prompt resolves to a typed failure result", async () => {
      const plugin = fakePlugin({ enable: vi.fn(async () => { throw pluginRejection("user_cancelled", "cancelled"); }) });
      const adapter = new NativeBiometricAuthAdapter(plugin);

      await expect(adapter.enable("u1", "Sam", "t")).resolves.toEqual({
        outcome: "failed",
        reason: "user_cancelled",
        error: "cancelled",
      });
    });

    it("falls back to unknown_error for an unrecognized native code", async () => {
      const plugin = fakePlugin({ enable: vi.fn(async () => { throw pluginRejection("some_future_code"); }) });
      const adapter = new NativeBiometricAuthAdapter(plugin);

      const result = await adapter.enable("u1", "Sam", "t");
      expect(result.outcome).toBe("failed");
      expect(result.reason).toBe("unknown_error");
    });
  });

  describe("authenticate", () => {
    it("returns the recovered token and accountId on success", async () => {
      const plugin = fakePlugin({ authenticate: vi.fn(async () => ({ token: "tok-123", accountId: "u1" })) });
      const adapter = new NativeBiometricAuthAdapter(plugin);

      await expect(adapter.authenticate()).resolves.toEqual({
        outcome: "success",
        token: "tok-123",
        accountId: "u1",
      });
    });

    it.each([
      ["user_cancelled"],
      ["authentication_failed"],
      ["unavailable"],
      ["not_enrolled"],
      ["lockout"],
      ["app_backgrounded"],
      ["credential_invalidated"],
      ["keychain_error"],
    ] as const)("maps native code %s through without loss", async (code) => {
      const plugin = fakePlugin({ authenticate: vi.fn(async () => { throw pluginRejection(code, `msg-${code}`); }) });
      const adapter = new NativeBiometricAuthAdapter(plugin);

      const result = await adapter.authenticate();
      expect(result).toEqual({ outcome: "failed", reason: code, error: `msg-${code}` });
    });

    it("tolerates a rejection with no .code at all", async () => {
      const plugin = fakePlugin({ authenticate: vi.fn(async () => { throw new Error("plain failure"); }) });
      const adapter = new NativeBiometricAuthAdapter(plugin);

      const result = await adapter.authenticate();
      expect(result).toEqual({ outcome: "failed", reason: "unknown_error", error: "plain failure" });
    });
  });

  describe("disable", () => {
    it("calls through to the plugin", async () => {
      const disable = vi.fn(async () => undefined);
      const adapter = new NativeBiometricAuthAdapter(fakePlugin({ disable }));
      await adapter.disable();
      expect(disable).toHaveBeenCalledOnce();
    });

    it("is best-effort — a native failure never throws or rejects", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const plugin = fakePlugin({ disable: vi.fn(async () => { throw new Error("keychain busy"); }) });
      const adapter = new NativeBiometricAuthAdapter(plugin);

      await expect(adapter.disable()).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
