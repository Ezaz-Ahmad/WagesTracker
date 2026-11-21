// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_REQUEST_TIMEOUT_MS } from "../../lib/networkRequest";
vi.mock("../../lib/errorFeedback", () => ({ showErrorPopup: vi.fn(), errorHintForStatus: () => "" }));
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("admin session resilience", () => {
  it("uses an in-memory session when browser storage is blocked", async () => {
    const api = await import("../adminApi");
    for (const method of ["getItem", "setItem", "removeItem"] as const) vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(api.getAdminToken()).toBeNull();
    api.setAdminToken("fixture-token"); expect(api.getAdminToken()).toBe("fixture-token");
    api.clearAdminToken(); expect(api.getAdminToken()).toBeNull();
  });
  it("respects a session removed by another tab", async () => {
    const api = await import("../adminApi"); api.setAdminToken("fixture-token");
    localStorage.removeItem("wageTracker.adminToken");
    expect(api.getAdminToken()).toBeNull();
  });
  it("bounds an admin request without retrying it or discarding the session", async () => {
    const api = await import("../adminApi"); api.setAdminToken("fixture-token");
    vi.useFakeTimers(); const fetch = vi.fn(() => new Promise<never>(() => {})); vi.stubGlobal("fetch", fetch);
    const assertion = expect(api.fetchAllUsers()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 0 });
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1); expect(api.getAdminToken()).toBe("fixture-token");
  });
});
