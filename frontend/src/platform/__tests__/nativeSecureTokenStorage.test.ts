import { KeychainAccess, type SecureStoragePlugin } from "@aparajita/capacitor-secure-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeSecureTokenStorageAdapter } from "../nativeSecureTokenStorage";

type SecureStore = Pick<
  SecureStoragePlugin,
  | "getItem"
  | "removeItem"
  | "setDefaultKeychainAccess"
  | "setItem"
  | "setKeyPrefix"
  | "setSynchronize"
>;

describe("NativeSecureTokenStorageAdapter", () => {
  let stored: string | null;
  let secureStore: SecureStore;

  beforeEach(() => {
    stored = null;
    secureStore = {
      getItem: vi.fn(async () => stored),
      removeItem: vi.fn(async () => { stored = null; }),
      setDefaultKeychainAccess: vi.fn(async () => {}),
      setItem: vi.fn(async (_key, value) => { stored = value; }),
      setKeyPrefix: vi.fn(async () => {}),
      setSynchronize: vi.fn(async () => {}),
    };
  });

  it("hydrates the synchronous cache from native secure storage", async () => {
    stored = JSON.stringify({ token: "native-token", remembered: false });
    const adapter = new NativeSecureTokenStorageAdapter(secureStore);

    await adapter.initialize();

    expect(adapter.getToken()).toBe("native-token");
    expect(adapter.isRemembered()).toBe(false);
    expect(secureStore.setKeyPrefix).toHaveBeenCalledWith("com.ezazahmad.wagestracker.auth.");
    expect(secureStore.setSynchronize).toHaveBeenCalledWith(false);
    expect(secureStore.setDefaultKeychainAccess).toHaveBeenCalledWith(
      KeychainAccess.whenUnlockedThisDeviceOnly
    );
  });

  it("persists token and Remember Me state as one atomic value", async () => {
    const adapter = new NativeSecureTokenStorageAdapter(secureStore);
    await adapter.initialize();

    await adapter.setToken("replacement-token", true);

    expect(JSON.parse(stored!)).toEqual({ token: "replacement-token", remembered: true });
    expect(adapter.getToken()).toBe("replacement-token");
    expect(adapter.isRemembered()).toBe(true);
  });

  it("does not update the cache before secure persistence succeeds", async () => {
    const adapter = new NativeSecureTokenStorageAdapter(secureStore);
    await adapter.initialize();
    (secureStore.setItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Keychain unavailable"));

    await expect(adapter.setToken("not-persisted", true)).rejects.toThrow("Keychain unavailable");
    expect(adapter.getToken()).toBeNull();
  });

  it("awaits secure removal before clearing the cache", async () => {
    stored = JSON.stringify({ token: "native-token", remembered: true });
    const adapter = new NativeSecureTokenStorageAdapter(secureStore);
    await adapter.initialize();
    let release = () => {};
    (secureStore.removeItem as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<void>((resolve) => { release = resolve; })
    );

    const clearing = adapter.clearToken();
    expect(adapter.getToken()).toBe("native-token");
    release();
    await clearing;
    expect(adapter.getToken()).toBeNull();
  });

  it("removes malformed secure-storage data instead of authenticating with it", async () => {
    stored = "not-json";
    const adapter = new NativeSecureTokenStorageAdapter(secureStore);

    await adapter.initialize();

    expect(adapter.getToken()).toBeNull();
    expect(secureStore.removeItem).toHaveBeenCalledWith("session");
  });
});
