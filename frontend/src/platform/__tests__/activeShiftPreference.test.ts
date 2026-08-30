import { describe, expect, it } from "vitest";
import { readActiveShiftPreference, writeActiveShiftPreference } from "../activeShiftPreference";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("active-shift preference", () => {
  it("defaults to off for every account", () => {
    expect(readActiveShiftPreference("account-1", new MemoryStorage())).toBe(false);
  });

  it("is isolated by account on the same installation", () => {
    const storage = new MemoryStorage();
    writeActiveShiftPreference("account-1", true, storage);
    expect(readActiveShiftPreference("account-1", storage)).toBe(true);
    expect(readActiveShiftPreference("account-2", storage)).toBe(false);
  });

  it("fails closed when device storage is unavailable", () => {
    const unavailable = {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
    };
    expect(() => writeActiveShiftPreference("account-1", true, unavailable)).not.toThrow();
    expect(readActiveShiftPreference("account-1", unavailable)).toBe(false);
  });
});
