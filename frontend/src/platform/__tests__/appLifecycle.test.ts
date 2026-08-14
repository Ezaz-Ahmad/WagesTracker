import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAppLifecycleAdapter, subscribeAppResume } from "../appLifecycle";
import { duringNativeActivity, resetNativeActivityForTests } from "../nativeActivity";

afterEach(resetNativeActivityForTests);

describe("application lifecycle abstraction", () => {
  it("forwards resume and cleans up the listener", async () => {
    let resume: (() => void) | undefined;
    const remove = vi.fn();
    configureAppLifecycleAdapter({
      addResumeListener: async (next) => { resume = next; return { remove }; },
    });
    const refresh = vi.fn();
    const dispose = subscribeAppResume(refresh);
    await Promise.resolve();
    resume?.();
    dispose();
    expect(refresh).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("ignores the temporary inactive/resume cycle caused by the share sheet", async () => {
    let resume: (() => void) | undefined;
    configureAppLifecycleAdapter({
      addResumeListener: async (next) => { resume = next; return { remove: vi.fn() }; },
    });
    const refresh = vi.fn();
    subscribeAppResume(refresh);
    await Promise.resolve();
    await duringNativeActivity(async () => { resume?.(); });
    resume?.();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("removes a listener that resolves after Strict Mode cleanup", async () => {
    let resolveHandle!: (value: { remove(): void }) => void;
    const remove = vi.fn();
    configureAppLifecycleAdapter({
      addResumeListener: () => new Promise((resolve) => { resolveHandle = resolve; }),
    });
    const dispose = subscribeAppResume(vi.fn());
    dispose();
    resolveHandle({ remove });
    await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
  });
});
