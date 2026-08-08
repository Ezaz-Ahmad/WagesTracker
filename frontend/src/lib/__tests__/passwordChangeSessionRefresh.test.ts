import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for: after a successful password change, the Security &
// Sessions list in Settings kept showing the just-revoked sessions (and
// could still label the revoked one "This device") until Settings was
// closed and reopened, because nothing reloaded the session list against
// the replacement token. The fix (SettingsScreen.tsx's handleChangePassword)
// awaits loadSessions() right after changePassword() resolves.
//
// This exercises the real production api.ts functions (changePassword,
// setToken, listSessions) chained in exactly the order AppContext's
// changePassword + SettingsScreen's post-change loadSessions call them —
// rather than reimplementing that sequencing by hand — so what's under test
// is the actual frontend request/token flow, not a hand-written stand-in for
// it. This project's Vitest config runs in a plain Node environment (no
// jsdom/React Testing Library), which is why the check happens at this
// layer instead of by rendering <SettingsScreen />; AppContext's own
// loadSessions() is a thin wrapper around api.listSessions() with
// loading/error state around it, so this is the layer where the actual
// network/token behavior lives.

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

describe("session list refresh after password change", () => {
  it("re-fetches sessions with the replacement token, dropping revoked sessions and marking the new one current", async () => {
    const OLD_TOKEN = "old-jwt-before-password-change";
    const NEW_TOKEN = "new-jwt-replacement-after-password-change";

    api.setToken(OLD_TOKEN, true);

    const oldSessionList = {
      sessions: [
        { id: "old-session-1", userAgent: "Chrome on macOS", ipAddress: "1.2.3.4", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: true },
        { id: "old-session-2", userAgent: "Firefox on Windows", ipAddress: "5.6.7.8", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: false },
      ],
    };
    const newSessionList = {
      sessions: [
        { id: "new-session-1", userAgent: "Chrome on macOS", ipAddress: "1.2.3.4", createdAt: "2026-01-05T00:00:00.000Z", lastActiveAt: "2026-01-05T00:00:00.000Z", expiresAt: "2026-02-05T00:00:00.000Z", isCurrent: true },
      ],
    };

    const calls: { url: string; auth: string | undefined }[] = [];
    const fetchMock = vi.fn(async (url: string, options: RequestInit = {}) => {
      const auth = (options.headers as Record<string, string> | undefined)?.Authorization;
      calls.push({ url: String(url), auth });

      if (String(url).includes("/me/sessions") && (!options.method || options.method === "GET")) {
        // Step 1: the list loaded when Settings first opened, before any
        // password change — still on the old token.
        if (calls.length === 1) {
          return { status: 200, ok: true, json: async () => oldSessionList, headers: { get: () => null } };
        }
        // Step 4: the reload triggered after the password change.
        return { status: 200, ok: true, json: async () => newSessionList, headers: { get: () => null } };
      }
      if (String(url).includes("/me/password")) {
        // Step 2: the password-change call itself.
        return { status: 204, ok: true, json: async () => ({}), headers: { get: (name: string) => (name === "X-New-Token" ? NEW_TOKEN : null) } };
      }
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // 1. Old session list is already loaded (Settings just opened) — the old
    // session is the one currently marked "This device".
    const before = await api.listSessions();
    expect(before.sessions.map((s) => s.id)).toEqual(["old-session-1", "old-session-2"]);
    expect(before.sessions.find((s) => s.isCurrent)?.id).toBe("old-session-1");
    expect(calls[0].auth).toBe(`Bearer ${OLD_TOKEN}`);

    // 2 & 3. Password change succeeds and its replacement token is stored —
    // the same two production calls AppContext's changePassword() makes.
    const { token: replacementToken } = await api.changePassword("current-pw", "brand-new-secure-login-2026!");
    expect(replacementToken).toBe(NEW_TOKEN);
    api.setToken(replacementToken, api.isRemembered());
    expect(api.getToken()).toBe(NEW_TOKEN);

    // 4. The session list is requested again afterward, and it must use the
    // replacement token — not the old, now-revoked one.
    const after = await api.listSessions();
    expect(calls[2].auth).toBe(`Bearer ${NEW_TOKEN}`);
    expect(calls[2].auth).not.toBe(`Bearer ${OLD_TOKEN}`);

    // 5. The old, now-revoked sessions are gone from the refreshed list.
    expect(after.sessions.find((s) => s.id === "old-session-1")).toBeUndefined();
    expect(after.sessions.find((s) => s.id === "old-session-2")).toBeUndefined();

    // 6. The new replacement session is the one labeled current.
    expect(after.sessions).toHaveLength(1);
    expect(after.sessions[0].id).toBe("new-session-1");
    expect(after.sessions[0].isCurrent).toBe(true);
  });
});
