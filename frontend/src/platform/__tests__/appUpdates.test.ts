import { describe, expect, it, vi } from "vitest";
import { AppUpdateService, isNewerAppVersion } from "../appUpdates";

const hour = 60 * 60 * 1000;
const update = { installedVersion: "1.21.1", latestVersion: "1.22.0" };

describe("App Store update decisions", () => {
  it.each([
    ["1.22.0", "1.21.1", true], ["1.10.0", "1.9.9", true],
    ["2.0", "1.99.9", true], ["1.22", "1.22.0", false],
    ["1.21.0", "1.22.0", false], ["1.22.0", "1.22.0", false],
    ["1.23.0-beta", "1.22.0", false], ["latest", "1.22.0", false],
    ["1.23.0", "invalid", false], ["1.2.3.4", "1.2.3", false],
  ])("compares public version %s with installed %s", (latest, installed, expected) => {
    expect(isNewerAppVersion(latest, installed)).toBe(expected);
  });

  it("shares an in-flight request and rechecks a published release after six hours", async () => {
    let now = 0;
    const lookup = vi.fn().mockResolvedValue(update);
    const service = new AppUpdateService({ lookup }, undefined, () => now);
    expect(await Promise.all([service.check(), service.check()])).toEqual([update, update]);
    expect(lookup).toHaveBeenCalledOnce();
    now = 5 * hour;
    expect(await service.check()).toEqual(update);
    expect(lookup).toHaveBeenCalledOnce();
    now = 6 * hour;
    await service.check();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("never offers a downgrade to a newer TestFlight installation or an identical release", async () => {
    const lookup = vi.fn().mockResolvedValue({ installedVersion: "1.22.0", latestVersion: "1.21.0" });
    expect(await new AppUpdateService({ lookup }).check()).toBeNull();
    lookup.mockResolvedValue({ installedVersion: "1.22.0", latestVersion: "1.22.0" });
    expect(await new AppUpdateService({ lookup }).check()).toBeNull();
  });

  it("persists Not now across launches and offers the latest release at the 48-hour boundary", async () => {
    let now = 100;
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
    const lookup = vi.fn().mockResolvedValue(update);
    const service = new AppUpdateService({ lookup }, storage, () => now);
    expect(await service.check()).toEqual(update);
    service.dismiss(update.latestVersion);
    const relaunched = new AppUpdateService({ lookup }, storage, () => now);
    expect(await relaunched.check()).toBeNull();
    now += 24 * hour;
    expect(await relaunched.check()).toBeNull();
    lookup.mockResolvedValue({ ...update, latestVersion: "1.22.1" });
    now += 24 * hour - 1;
    expect(await relaunched.check()).toBeNull();
    expect(relaunched.nextCheckDelay()).toBe(1);
    now += 1;
    expect(await relaunched.check()).toEqual({ ...update, latestVersion: "1.22.1" });
    relaunched.dismiss("1.22.1");
    now += 48 * hour - 1;
    expect(await relaunched.check()).toBeNull();
    now += 1;
    expect(await relaunched.check()).toEqual({ ...update, latestVersion: "1.22.1" });
  });

  it("stops reminding after installation and detects later releases automatically", async () => {
    let now = 0;
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
    const lookup = vi.fn().mockResolvedValue(update);
    const original = new AppUpdateService({ lookup }, storage, () => now);
    expect(await original.check()).toEqual(update);
    original.dismiss(update.latestVersion);
    now = 48 * hour;
    lookup.mockResolvedValue({ installedVersion: "1.22.0", latestVersion: "1.22.0" });
    const updatedInstallation = new AppUpdateService({ lookup }, storage, () => now);
    expect(await updatedInstallation.check()).toBeNull();
    now += 6 * hour;
    lookup.mockResolvedValue({ installedVersion: "1.22.0", latestVersion: "2.0.0" });
    expect(await updatedInstallation.check()).toEqual({ installedVersion: "1.22.0", latestVersion: "2.0.0" });
  });

  it("refreshes Apple's versions at the reminder deadline even after a recent cached check", async () => {
    let now = 0;
    const lookup = vi.fn().mockResolvedValue(update);
    const service = new AppUpdateService({ lookup }, undefined, () => now);
    await service.check();
    service.dismiss(update.latestVersion);
    now = 48 * hour - 1;
    expect(await service.check()).toBeNull();
    lookup.mockResolvedValue({ ...update, latestVersion: "1.23.0" });
    now += 1;
    expect(await service.check()).toEqual({ ...update, latestVersion: "1.23.0" });
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("fails quietly offline and backs off failed requests before trying again", async () => {
    let now = 0;
    const lookup = vi.fn().mockRejectedValue(new Error("offline"));
    const service = new AppUpdateService({ lookup }, undefined, () => now);
    expect(await service.check()).toBeNull();
    now = 14 * 60 * 1000;
    expect(await service.check()).toBeNull();
    expect(lookup).toHaveBeenCalledOnce();
    now = 15 * 60 * 1000;
    lookup.mockResolvedValue(update);
    expect(await service.check()).toEqual(update);
  });

  it("keeps working with corrupt or unavailable storage", async () => {
    const storage = { getItem: () => "{broken", setItem: () => { throw new Error("blocked"); } };
    const service = new AppUpdateService({ lookup: async () => update }, storage);
    expect(await service.check()).toEqual(update);
    service.dismiss(update.latestVersion);
    expect(await service.check()).toBeNull();
  });

  it("recovers when an adapter fails synchronously", async () => {
    let now = 0;
    const lookup = vi.fn(() => { throw new Error("native bridge unavailable"); });
    const service = new AppUpdateService({ lookup }, undefined, () => now);
    expect(await service.check()).toBeNull();
    now = 15 * 60 * 1000;
    expect(await service.check()).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
