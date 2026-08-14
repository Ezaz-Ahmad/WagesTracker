import { describe, expect, it } from "vitest";
import {
  assertSafeNativeReleaseEnvironment,
  parseAppBuildTarget,
  PRODUCTION_API_URL,
} from "../nativeReleaseConfig";

const safe = { target: "ios", mode: "production", apiUrl: PRODUCTION_API_URL };

describe("native release configuration", () => {
  it("accepts the pinned HTTPS production API", () => {
    expect(() => assertSafeNativeReleaseEnvironment(safe)).not.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["localhost", "http://localhost:4000"],
    ["plain HTTP", "http://wage-tracker-api.onrender.com"],
    ["development", "https://dev-api.example.com"],
  ])("rejects a %s API URL", (_label, apiUrl) => {
    expect(() => assertSafeNativeReleaseEnvironment({ ...safe, apiUrl })).toThrow();
  });

  it("rejects Capacitor live reload and viewport diagnostics", () => {
    expect(() => assertSafeNativeReleaseEnvironment({ ...safe, capacitorServerUrl: "http://192.168.1.2:5173" }))
      .toThrow(/live-reload/);
    expect(() => assertSafeNativeReleaseEnvironment({ ...safe, viewportDebug: "true" }))
      .toThrow(/Viewport debugging/);
  });

  it("does not constrain ordinary web development", () => {
    expect(() => assertSafeNativeReleaseEnvironment({ target: "web", mode: "development", apiUrl: "http://localhost:4000" }))
      .not.toThrow();
  });

  it.each(["web", "ios", "android"])("accepts the %s application target", (target) => {
    expect(parseAppBuildTarget(target)).toBe(target);
  });

  it("defaults an unset target to web", () => {
    expect(parseAppBuildTarget(undefined)).toBe("web");
  });

  it.each(["iso", "iphone", "native", "WEB", " ios "])("rejects the unknown target %s", (target) => {
    expect(() => parseAppBuildTarget(target)).toThrow(/Invalid VITE_APP_TARGET/);
    expect(() =>
      assertSafeNativeReleaseEnvironment({ target, mode: "production", apiUrl: PRODUCTION_API_URL })
    ).toThrow(/Invalid VITE_APP_TARGET/);
  });
});
