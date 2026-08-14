import { beforeEach, describe, expect, it } from "vitest";
import { WebTokenStorageAdapter } from "../tokenStorage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

describe("WebTokenStorageAdapter", () => {
  let persistent: Storage;
  let sessionOnly: Storage;
  let storage: WebTokenStorageAdapter;

  beforeEach(() => {
    persistent = memoryStorage();
    sessionOnly = memoryStorage();
    storage = new WebTokenStorageAdapter(persistent, sessionOnly);
  });

  it("persists Remember Me sessions only in localStorage", async () => {
    await storage.setToken("remembered", true);
    expect(storage.getToken()).toBe("remembered");
    expect(storage.isRemembered()).toBe(true);
    expect(sessionOnly.length).toBe(0);
  });

  it("keeps non-remembered sessions only in sessionStorage", async () => {
    await storage.setToken("session-only", false);
    expect(storage.getToken()).toBe("session-only");
    expect(storage.isRemembered()).toBe(false);
    expect(persistent.length).toBe(0);
  });

  it("moves a token between storage classes without leaving a duplicate", async () => {
    await storage.setToken("first", true);
    await storage.setToken("second", false);
    expect(persistent.length).toBe(0);
    expect(storage.getToken()).toBe("second");
  });

  it("clears both storage classes", async () => {
    await storage.setToken("token", true);
    sessionOnly.setItem("wageTracker.token", "stale");
    await storage.clearToken();
    expect(storage.getToken()).toBeNull();
  });
});
