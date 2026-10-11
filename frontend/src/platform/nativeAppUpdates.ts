import { App } from "@capacitor/app";
import { CapacitorHttp } from "@capacitor/core";
import { APP_STORE_ID, IOS_BUNDLE_ID, type AppUpdateAdapter, type AvailableAppUpdate } from "./appUpdates";

export class IosAppUpdateAdapter implements AppUpdateAdapter {
  async lookup(): Promise<AvailableAppUpdate | null> {
    const installed = await App.getInfo();
    if (installed.id !== IOS_BUNDLE_ID) return null;
    // Native HTTP avoids WebView CORS restrictions. Apple supplies public
    // release metadata; no account, shift, token or device ID is transmitted.
    const response = await CapacitorHttp.get({
      url: "https://itunes.apple.com/lookup",
      params: { id: String(APP_STORE_ID), country: "au", entity: "software" },
      responseType: "json",
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    if (response.status !== 200) throw new Error("App Store lookup unavailable");
    const data: unknown = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) return null;
    const listing = data.results.find((item: unknown) => item && typeof item === "object" &&
      "trackId" in item && item.trackId === APP_STORE_ID &&
      "bundleId" in item && item.bundleId === IOS_BUNDLE_ID);
    if (!listing || typeof listing.version !== "string") return null;
    return { installedVersion: installed.version, latestVersion: listing.version };
  }
}
