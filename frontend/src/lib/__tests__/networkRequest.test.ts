import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, withRequestTimeout } from "../networkRequest";

afterEach(() => vi.useRealTimers());
describe("bounded network operations", () => {
  it("times out even if the transport ignores cancellation", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const operation = vi.fn((value: AbortSignal) => { signal = value; return new Promise<never>(() => {}); });
    const pending = withRequestTimeout(operation, { timeoutMs: 50 });
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("cleans up its timer after success", async () => {
    vi.useFakeTimers();
    expect(await withRequestTimeout(async () => "ready")).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start an operation that was already cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    const operation = vi.fn();
    await expect(withRequestTimeout(operation, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("forwards cancellation and removes the deadline", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = withRequestTimeout(() => new Promise<never>(() => {}), { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
