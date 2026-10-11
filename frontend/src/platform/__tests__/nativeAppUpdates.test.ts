import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_STORE_ID, IOS_BUNDLE_ID } from "../appUpdates";
import { IosAppUpdateAdapter } from "../nativeAppUpdates";

const native = vi.hoisted(() => ({ getInfo: vi.fn(), get: vi.fn() }));
vi.mock("@capacitor/app", () => ({ App: { getInfo: native.getInfo } }));
vi.mock("@capacitor/core", () => ({ CapacitorHttp: { get: native.get } }));
const listing = { trackId: APP_STORE_ID, bundleId: IOS_BUNDLE_ID, version: "1.23.0", trackViewUrl: "https://untrusted.example.invalid/" };

beforeEach(() => {
  vi.clearAllMocks();
  native.getInfo.mockResolvedValue({ id: IOS_BUNDLE_ID, version: "1.22.0", build: "50" });
  native.get.mockResolvedValue({ status: 200, data: { results: [listing] } });
});

describe("native public App Store lookup", () => {
  it("uses the installed native version and exact app ID without sending account data", async () => {
    expect(await new IosAppUpdateAdapter().lookup()).toEqual({ installedVersion: "1.22.0", latestVersion: "1.23.0" });
    expect(native.get).toHaveBeenCalledWith({
      url: "https://itunes.apple.com/lookup", params: { id: String(APP_STORE_ID), country: "au", entity: "software" },
      responseType: "json", connectTimeout: 8000, readTimeout: 8000,
    });
  });

  it.each([{ results: [] }, { results: [{ ...listing, trackId: 123 }] },
    { results: [{ ...listing, bundleId: "other.app" }] }, { results: [{ ...listing, version: null }] },
    {}, null])("ignores missing or mismatched listings: %j", async (data) => {
    native.get.mockResolvedValue({ status: 200, data });
    expect(await new IosAppUpdateAdapter().lookup()).toBeNull();
  });

  it("accepts Apple's JSON text response", async () => {
    native.get.mockResolvedValue({ status: 200, data: JSON.stringify({ results: [listing] }) });
    expect(await new IosAppUpdateAdapter().lookup()).toEqual({ installedVersion: "1.22.0", latestVersion: "1.23.0" });
  });

  it("lets the service retry temporary failures", async () => {
    native.get.mockResolvedValue({ status: 503, data: {} });
    await expect(new IosAppUpdateAdapter().lookup()).rejects.toThrow("lookup unavailable");
  });

  it("skips unrelated builds", async () => {
    native.getInfo.mockResolvedValue({ id: "other.app", version: "1.22.0" });
    expect(await new IosAppUpdateAdapter().lookup()).toBeNull();
    expect(native.get).not.toHaveBeenCalled();
  });
});
