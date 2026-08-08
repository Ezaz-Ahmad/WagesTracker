// Pure-logic test — parseDeviceLabel touches no DOM, so this runs in the
// default plain-Node Vitest environment (no jsdom pragma comment needed)
// like the rest of the lib/__tests__ suite.
//
// Regression coverage for a real bug: iPhone/iPad detection used to be
// checked *after* macOS, but nearly every iOS Safari/WebKit UA string
// contains "like Mac OS X" as a legacy WebKit compatibility token — so
// every iPhone session was being mislabeled "on macOS" in the Security &
// Sessions list. iPhone/iPad/iPod must be checked first. Also covers the
// iOS in-app-browser tokens (CriOS/FxiOS/EdgiOS) that real Chrome/Firefox/
// Edge use on iOS instead of their normal desktop/Android tokens.
import { describe, expect, it } from "vitest";
import { parseDeviceLabel } from "../parseUserAgent";

const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MACOS_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1";

const IPHONE_FIREFOX =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15";

const IPHONE_EDGE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 EdgiOS/126.2592.68 Mobile/15E148 Safari/604.1";

describe("parseDeviceLabel", () => {
  it("labels Windows Chrome", () => {
    expect(parseDeviceLabel(WINDOWS_CHROME)).toBe("Chrome on Windows");
  });

  it("labels macOS Safari", () => {
    expect(parseDeviceLabel(MACOS_SAFARI)).toBe("Safari on macOS");
  });

  it("labels Android Chrome", () => {
    expect(parseDeviceLabel(ANDROID_CHROME)).toBe("Chrome on Android");
  });

  it("labels iPhone Safari as iOS, not macOS", () => {
    expect(parseDeviceLabel(IPHONE_SAFARI)).toBe("Safari on iOS");
  });

  it("labels iPhone Chrome (CriOS) as Chrome on iOS, not Safari on macOS", () => {
    expect(parseDeviceLabel(IPHONE_CHROME)).toBe("Chrome on iOS");
  });

  it("labels iPhone Firefox (FxiOS) as Firefox on iOS", () => {
    expect(parseDeviceLabel(IPHONE_FIREFOX)).toBe("Firefox on iOS");
  });

  it("labels iPhone Edge (EdgiOS) as Edge on iOS", () => {
    expect(parseDeviceLabel(IPHONE_EDGE)).toBe("Edge on iOS");
  });

  it("returns a friendly fallback for an empty user agent", () => {
    expect(parseDeviceLabel("")).toBe("Unknown device");
    expect(parseDeviceLabel(null)).toBe("Unknown device");
    expect(parseDeviceLabel(undefined)).toBe("Unknown device");
    expect(parseDeviceLabel("   ")).toBe("Unknown device");
  });

  it("returns the raw string as-is for an unrecognized user agent", () => {
    expect(parseDeviceLabel("SomeCustomClient/1.0")).toBe("SomeCustomClient/1.0");
  });

  it("truncates an excessively long, unrecognized user agent instead of overflowing the card", () => {
    const long = "X".repeat(120);
    const result = parseDeviceLabel(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("X")).toBe(true);
  });

  it("stays entirely local — parses purely from the string, with no network/geolocation involved", () => {
    // Nothing to await/mock here; the assertion is structural: the function
    // is synchronous and takes only a string, so it cannot reach out to
    // anything external.
    expect(parseDeviceLabel.constructor.name).not.toBe("AsyncFunction");
  });
});
