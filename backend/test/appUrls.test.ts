import { afterEach, describe, expect, it, vi } from "vitest";
import { appBaseUrl, passwordResetUrl, supportUrl } from "../src/config/appUrls.js";

describe("transactional email public URLs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the local frontend only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "");
    expect(appBaseUrl()).toBe("http://localhost:5173");
  });

  it("requires an explicit HTTPS origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    for (const configured of [
      "",
      "http://wages.example.com",
      "https://user:secret@wages.example.com",
      "https://wages.example.com/an-unexpected-path",
      "https://wages.example.com?source=wrong",
      "https://wages.example.com#fragment",
    ]) {
      vi.stubEnv("APP_BASE_URL", configured);
      expect(appBaseUrl()).toBeNull();
    }
  });

  it("normalizes a valid production origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://wages.example.com///");
    expect(appBaseUrl()).toBe("https://wages.example.com");
    expect(supportUrl()).toBe("https://wages.example.com/support");
  });

  it("puts an encoded reset credential in the fragment, never the query", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://wages.example.com");
    const url = passwordResetUrl("token with spaces/+?");
    expect(url).toBe("https://wages.example.com/reset-password#token=token%20with%20spaces%2F%2B%3F");
    expect(url).not.toContain("?token=");
  });
});
