export type AppBuildTarget = "web" | "ios" | "android";

export const PRODUCTION_API_URL = "https://wage-tracker-api.onrender.com";

export interface NativeReleaseEnvironment {
  target?: string;
  mode: string;
  apiUrl?: string;
  capacitorServerUrl?: string;
  viewportDebug?: string;
}

export function isNativeConsumerTarget(target?: string): target is "ios" | "android" {
  return target === "ios" || target === "android";
}

/** Fails the build before native consumer assets are emitted. Development
 * web builds remain flexible; signed native release builds are deliberately
 * pinned to the known HTTPS API and may never embed a live-reload server. */
export function assertSafeNativeReleaseEnvironment(environment: NativeReleaseEnvironment): void {
  if (!isNativeConsumerTarget(environment.target) || environment.mode !== "production") return;

  if (!environment.apiUrl) {
    throw new Error("Native production builds require VITE_API_URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(environment.apiUrl);
  } catch {
    throw new Error("Native production builds require a valid production API URL.");
  }

  if (parsed.protocol !== "https:" || environment.apiUrl.replace(/\/+$/, "") !== PRODUCTION_API_URL) {
    throw new Error(`Native production builds must use ${PRODUCTION_API_URL}.`);
  }
  if (environment.capacitorServerUrl) {
    throw new Error("Native production builds must not include a Capacitor live-reload server URL.");
  }
  if (environment.viewportDebug === "true") {
    throw new Error("Viewport debugging must be disabled in native production builds.");
  }
}
