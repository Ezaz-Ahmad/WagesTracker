import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDeepLink,
  getDeepLink,
  handleIncomingUrl,
  parseDeepLink,
  resetDeepLinksForTests,
  subscribeDeepLink,
} from "../deepLinks";

afterEach(resetDeepLinksForTests);

describe("password recovery deep links", () => {
  const token = "a".repeat(43);

  it("parses the fragment-token form used by new reset emails", () => {
    expect(parseDeepLink(`https://wages-tracker-frontend.vercel.app/reset-password#token=${token}`)).toEqual({
      screen: "reset-password",
      token,
    });
  });

  it("rejects query-string credentials and links from any unassociated host", () => {
    expect(parseDeepLink(`https://wages-tracker-frontend.vercel.app/reset-password?token=${token}`)).toBeNull();
    expect(parseDeepLink(`https://example.com/reset-password#token=${token}`)).toBeNull();
  });

  it("ignores unrelated, malformed, empty, and excessively large links", () => {
    expect(parseDeepLink(`https://wages-tracker-frontend.vercel.app/settings#token=${token}`)).toBeNull();
    expect(parseDeepLink("https://wages-tracker-frontend.vercel.app/reset-password")).toBeNull();
    expect(parseDeepLink("not a URL")).toBeNull();
    expect(parseDeepLink(`https://wages-tracker-frontend.vercel.app/reset-password#token=${"x".repeat(44)}`)).toBeNull();
  });

  it("publishes and clears an incoming native route without persisting it", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDeepLink(listener);
    expect(handleIncomingUrl(`https://wages-tracker-frontend.vercel.app/reset-password#token=${token}`)).toBe(true);
    expect(getDeepLink()).toEqual({ screen: "reset-password", token });
    expect(listener).toHaveBeenCalledWith({ screen: "reset-password", token });
    clearDeepLink();
    expect(getDeepLink()).toBeNull();
    unsubscribe();
  });
});
