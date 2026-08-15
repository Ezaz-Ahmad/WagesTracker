// The shared contract's default (web) behavior, and the configure/get
// plumbing every native adapter swap relies on — same shape as
// tokenStorage.test.ts's coverage of its own web default + configure.
import { afterEach, describe, expect, it } from "vitest";
import {
  authenticateWithBiometrics,
  checkBiometricCapabilities,
  configureBiometricAuth,
  disableBiometricLogin,
  enableBiometricLogin,
  getBiometricStatus,
  type BiometricAuthAdapter,
} from "../biometricAuth";

// configureBiometricAuth has module-level state with no reset export (same
// as tokenStorage's `activeAdapter`) — restore the default web adapter after
// any test that swaps it in, so test order can't leak between files.
afterEach(() => {
  configureBiometricAuth({
    checkCapabilities: async () => ({ kind: "none", enrolled: false }),
    getStatus: async () => ({ enabled: false }),
    enable: async () => ({ outcome: "failed", reason: "unavailable" }),
    authenticate: async () => ({ outcome: "failed", reason: "unavailable" }),
    disable: async () => {},
  });
});

describe("web (default) biometric adapter", () => {
  it("reports no capability, with an explanatory reason", async () => {
    const capabilities = await checkBiometricCapabilities();
    expect(capabilities.kind).toBe("none");
    expect(capabilities.enrolled).toBe(false);
    expect(capabilities.reason).toMatch(/iOS app/i);
  });

  it("reports biometric login as never enabled", async () => {
    await expect(getBiometricStatus()).resolves.toEqual({ enabled: false });
  });

  it("enable() always fails with reason unavailable — never silently pretends success", async () => {
    const result = await enableBiometricLogin("u1", "Sam", "token");
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("unavailable");
  });

  it("authenticate() always fails with reason unavailable", async () => {
    const result = await authenticateWithBiometrics();
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("unavailable");
  });

  it("disable() is a no-op that never throws", async () => {
    await expect(disableBiometricLogin()).resolves.toBeUndefined();
  });
});

describe("configureBiometricAuth", () => {
  it("swaps the active adapter for every subsequent call", async () => {
    const fake: BiometricAuthAdapter = {
      checkCapabilities: async () => ({ kind: "faceId", enrolled: true }),
      getStatus: async () => ({ enabled: true, accountId: "u1", accountLabel: "Sam", kind: "faceId" }),
      enable: async () => ({ outcome: "enabled", kind: "faceId" }),
      authenticate: async () => ({ outcome: "success", token: "t", accountId: "u1" }),
      disable: async () => {},
    };
    configureBiometricAuth(fake);

    await expect(checkBiometricCapabilities()).resolves.toEqual({ kind: "faceId", enrolled: true });
    await expect(getBiometricStatus()).resolves.toEqual({
      enabled: true,
      accountId: "u1",
      accountLabel: "Sam",
      kind: "faceId",
    });
    await expect(enableBiometricLogin("u1", "Sam", "t")).resolves.toEqual({ outcome: "enabled", kind: "faceId" });
    await expect(authenticateWithBiometrics()).resolves.toEqual({ outcome: "success", token: "t", accountId: "u1" });
  });
});
