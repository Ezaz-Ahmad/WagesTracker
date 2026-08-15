import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import config from "../../../capacitor.config";

const frontendPackage = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const packageLock = JSON.parse(readFileSync("../package-lock.json", "utf8")) as {
  packages: { frontend: { version: string } };
};
const xcodeProject = readFileSync("../ios/App/App.xcodeproj/project.pbxproj", "utf8");
const infoPlist = readFileSync("../ios/App/App/Info.plist", "utf8");
const swiftPackage = readFileSync("../ios/App/CapApp-SPM/Package.swift", "utf8");
const swiftResolution = JSON.parse(
  readFileSync("../ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved", "utf8")
) as { pins: Array<{ identity: string; state: { version: string } }> };

describe("Capacitor production configuration", () => {
  it("uses the shared Vite output and permanent application identity", () => {
    expect(config).toMatchObject({
      appId: "com.ezazahmad.wagestracker",
      appName: "WagesTracker",
      webDir: "dist",
      ios: { path: "../ios", scheme: "App" },
    });
    expect(xcodeProject).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.ezazahmad.wagestracker;");
    expect(xcodeProject).toContain("IPHONEOS_DEPLOYMENT_TARGET = 15.0;");
    expect(xcodeProject).toContain("MARKETING_VERSION = 1.16.0;");
    expect(frontendPackage.version).toBe("1.16.0");
    expect(packageLock.packages.frontend.version).toBe("1.16.0");
    expect(xcodeProject).toContain("TARGETED_DEVICE_FAMILY = 1;");
    expect(xcodeProject).not.toContain('TARGETED_DEVICE_FAMILY = "1,2";');
    expect(swiftPackage).toContain('capacitor-swift-pm.git", exact: "8.4.2"');
    expect(swiftPackage).toContain('AparajitaCapacitorSecureStorage", path: "../../../node_modules/');
    expect(swiftResolution.pins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identity: "capacitor-swift-pm", state: expect.objectContaining({ version: "8.4.2" }) }),
        expect.objectContaining({ identity: "keychain-swift", state: expect.objectContaining({ version: "21.0.0" }) }),
      ])
    );
  });

  it("never embeds a live-reload server or cleartext transport override", () => {
    expect(config.server).toBeUndefined();
    expect(JSON.stringify(config)).not.toMatch(/localhost|http:|cleartext|allowNavigation/i);
    expect(infoPlist).not.toMatch(/NSAppTransportSecurity|NSAllowsArbitraryLoads/);
    // NSFaceIDUsageDescription is the one deliberate exception: Face ID
    // access requires it (see the biometric-login feature), and its exact
    // copy is pinned below. Any other NS*UsageDescription key showing up
    // here would mean a permission was added without the same review.
    const usageDescriptionKeys = [...infoPlist.matchAll(/NS[A-Za-z]+UsageDescription/g)].map((m) => m[0]);
    expect(usageDescriptionKeys).toEqual(["NSFaceIDUsageDescription"]);
    expect(infoPlist).toContain(
      "<key>NSFaceIDUsageDescription</key>\n\t<string>Use Face ID to securely unlock WagesTracker.</string>"
    );
    expect(swiftPackage).not.toContain("\\");
  });
});
