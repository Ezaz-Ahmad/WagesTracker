// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { API_REQUEST_TIMEOUT_MS } from "../networkRequest";
const { popup } = vi.hoisted(() => ({ popup: vi.fn() }));
vi.mock("../errorFeedback", () => ({ showErrorPopup: popup, errorHintForStatus: () => "" }));
beforeEach(() => { vi.clearAllMocks(); api.setJobScope(null); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("API failure recovery", () => {
  it("releases a stalled save without retrying an uncertain write", async () => {
    vi.useFakeTimers(); const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<never>(() => {})); vi.stubGlobal("fetch", fetch);
    const assertion = expect(api.patchMe({ name: "Updated" })).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 0 });
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(popup).toHaveBeenCalledTimes(1);
    expect(popup.mock.calls[0][0].message).toMatch(/Refresh to check/);
  });
  it("bounds a stalled body reader and keeps biometric-token verification quiet", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise<never>(() => {}) }));
    const assertion = expect(api.fetchMeWithToken("isolated-test-token")).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 0 });
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS); await assertion;
    expect(popup).not.toHaveBeenCalled();
  });
  it("rejects corrupt successful responses instead of passing empty data to a screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>upstream problem</html>", { status: 200 })));
    await expect(api.fetchMe()).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 502 });
    expect(popup).toHaveBeenCalledTimes(1);
  });
  it("handles a null error body as an HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", { status: 503 })));
    await expect(api.fetchMe()).rejects.toMatchObject({ status: 503 });
    expect(popup).toHaveBeenCalledTimes(1);
  });
});
