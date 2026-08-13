import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function storage(): Storage {
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

let api: typeof import("../api");

beforeEach(async () => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  vi.resetModules();
  api = await import("../api");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(status = 200, body: unknown = { shift: {} }) {
  const fn = vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("shift-write timezone header", () => {
  it("adds the current device IANA timezone to create and update requests", async () => {
    const fetchMock = mockFetch();
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const shift = { date: "2026-08-13", location: "", signIn: "09:00", signOut: "17:00" };

    await api.createShift(shift);
    await api.patchShift("shift-1", { signOut: "18:00" });
    await api.patchShift("shift-1", { location: "New location" });

    for (const [, options] of fetchMock.mock.calls) {
      expect((options.headers as Record<string, string>)["X-Client-Time-Zone"]).toBe(expected);
    }
  });

  it("does not add the timezone header to read-only shift requests", async () => {
    const fetchMock = mockFetch(200, { shifts: [] });
    await api.listShifts("2026-08-01", "2026-08-07");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)["X-Client-Time-Zone"]).toBeUndefined();
  });

  it("turns backend timezone validation into a user-friendly message", async () => {
    mockFetch(400, { error: "A valid device time zone is required", code: "INVALID_CLIENT_TIME_ZONE" });
    await expect(api.createShift({ date: "2026-08-13", location: "", signIn: "09:00", signOut: "17:00" }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/device time zone.*refresh/i) });
  });
});
