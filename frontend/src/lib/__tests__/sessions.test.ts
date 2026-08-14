import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests run in a plain Node environment (see vitest.config.ts — no
// jsdom, matching this project's existing "pure lib logic only" test
// convention), so browser globals api.ts relies on (fetch, localStorage,
// sessionStorage) are stubbed by hand rather than pulled in via a DOM
// library. Each test gets a fresh in-memory storage and a fresh mocked
// fetch so requests/responses from one test can never leak into another.

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

let api: typeof import("../api");

beforeEach(async () => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  vi.stubGlobal("sessionStorage", createMemoryStorage());
  vi.resetModules();
  api = await import("../api");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("session API calls (lib/api.ts)", () => {
  it("listSessions fetches from /api/me/sessions with the stored auth token, and the current device is identified via isCurrent", async () => {
    api.setToken("test-jwt-token");
    const sessions = [
      { id: "sess-1", userAgent: "Chrome on macOS", ipAddress: "1.2.3.4", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: true },
      { id: "sess-2", userAgent: "Firefox on Windows", ipAddress: "5.6.7.8", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: false },
    ];
    const fetchMock = mockFetchOnce(200, { sessions });

    const result = await api.listSessions();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/me/sessions");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-jwt-token");

    expect(result.sessions).toHaveLength(2);
    const current = result.sessions.filter((s) => s.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe("sess-1");
  });

  it("revokeSession sends a DELETE to /api/me/sessions/:id and returns whether the current session was the one revoked", async () => {
    api.setToken("test-jwt-token");
    const fetchMock = mockFetchOnce(200, { revokedCurrent: false });

    const result = await api.revokeSession("sess-2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/me/sessions/sess-2");
    expect(options.method).toBe("DELETE");
    expect(result.revokedCurrent).toBe(false);
  });

  it("'log out all other devices' (revokeOtherSessions) hits DELETE /api/me/sessions/others, not a per-session id", async () => {
    api.setToken("test-jwt-token");
    const fetchMock = mockFetchOnce(204, undefined);

    await api.revokeOtherSessions();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/me/sessions/others");
    expect(options.method).toBe("DELETE");
  });

  it("resolves normally on success and rejects with the server's error message on failure — the data these UI loading/success/error states are driven by", async () => {
    api.setToken("test-jwt-token");
    mockFetchOnce(200, { sessions: [] });
    await expect(api.listSessions()).resolves.toEqual({ sessions: [] });

    vi.resetModules();
    api = await import("../api");
    api.setToken("test-jwt-token");
    mockFetchOnce(401, { error: "Invalid or expired token" });
    await expect(api.listSessions()).rejects.toMatchObject({ message: "Invalid or expired token", status: 401 });
  });

  it("never includes a token, password, or password hash in a parsed sessions response", async () => {
    api.setToken("test-jwt-token");
    const sessions = [
      { id: "sess-1", userAgent: "Chrome on macOS", ipAddress: "1.2.3.4", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: true },
    ];
    mockFetchOnce(200, { sessions });

    const result = await api.listSessions();
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("password");
  });

  it("logout() (the raw API call) propagates a failure rather than swallowing it — callers are responsible for still clearing local auth", async () => {
    api.setToken("test-jwt-token");
    mockFetchOnce(500, { error: "Internal server error" });

    await expect(api.logout()).rejects.toBeTruthy();
  });

  it("local auth is cleared even when the server-side logout call fails", async () => {
    api.setToken("test-jwt-token", true);
    expect(api.getToken()).toBe("test-jwt-token");
    mockFetchOnce(500, { error: "Internal server error" });

    // Mirrors AppContext's logout(): fire the best-effort server call,
    // swallow whatever it does, and clear local storage regardless —
    // proving the local cleanup never depends on the network call succeeding.
    await api.logout().catch(() => {});
    await api.clearToken();

    expect(api.getToken()).toBeNull();
  });
});
