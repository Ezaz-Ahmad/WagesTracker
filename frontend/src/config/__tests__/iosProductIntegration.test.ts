import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const privacyPath = new URL("../../../../ios/App/App/PrivacyInfo.xcprivacy", import.meta.url);
const projectPath = new URL("../../../../ios/App/App.xcodeproj/project.pbxproj", import.meta.url);
const packagePath = new URL("../../../../ios/App/CapApp-SPM/Package.swift", import.meta.url);
const notificationPluginPath = new URL("../../../../ios/App/App/ActiveShiftActivityPlugin.swift", import.meta.url);
const notificationCoordinatorPath = new URL("../../../../ios/App/App/ShiftActivityCoordinator.swift", import.meta.url);
const appDelegatePath = new URL("../../../../ios/App/App/AppDelegate.swift", import.meta.url);

function pngDimensions(path: URL): [number, number] {
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("iOS product integration configuration", () => {
  it("declares the Filesystem timestamp reason and includes the app manifest in target resources", () => {
    const privacy = readFileSync(privacyPath, "utf8");
    const project = readFileSync(projectPath, "utf8");
    expect(privacy).toContain("NSPrivacyAccessedAPICategoryFileTimestamp");
    expect(privacy).toContain("C617.1");
    expect(project).toContain("PrivacyInfo.xcprivacy in Resources");
  });

  it("accurately declares linked app-functionality data without tracking", () => {
    const privacy = readFileSync(privacyPath, "utf8");
    expect(privacy).toContain("<key>NSPrivacyTracking</key>\n    <false/>");
    for (const category of ["Name", "EmailAddress", "PhysicalAddress", "OtherFinancialInfo", "UserID", "DeviceID"]) {
      expect(privacy).toContain(`NSPrivacyCollectedDataType${category}`);
    }
    expect(privacy).toContain("NSPrivacyCollectedDataTypePurposeAppFunctionality");
  });

  it("keeps full-size brand sources and exact native plugin package paths", () => {
    expect(pngDimensions(new URL("../../../assets/icon-only.png", import.meta.url))).toEqual([1024, 1024]);
    expect(pngDimensions(new URL("../../../assets/splash.png", import.meta.url))).toEqual([2732, 2732]);
    const swiftPackage = readFileSync(packagePath, "utf8");
    for (const plugin of ["CapacitorApp", "CapacitorFilesystem", "CapacitorNetwork", "CapacitorShare"]) {
      expect(swiftPackage).toContain(`node_modules/@capacitor/${plugin.replace("Capacitor", "").toLowerCase()}`);
    }
  });

  it("registers one-shot smart reminders with safe foreground confirmation actions", () => {
    const plugin = readFileSync(notificationPluginPath, "utf8");
    const coordinator = readFileSync(notificationCoordinatorPath, "utf8");
    const delegate = readFileSync(appDelegatePath, "utf8");

    expect(plugin).toContain("scheduleSmartReminders");
    expect(plugin).toContain('notifyListeners("smartReminderAction"');
    expect(delegate).toContain("SmartShiftReminderCoordinator.registerCategories()");
    expect(coordinator).toContain('title: "Sign In"');
    expect(coordinator).toContain('title: "Sign Out"');
    expect(coordinator).toContain('title: "Remind Me Later"');
    expect(coordinator).toContain('title: "Dismiss"');
    expect(coordinator).toContain("options: [.foreground, .authenticationRequired]");
    expect(coordinator).toContain("UNTimeIntervalNotificationTrigger(timeInterval: 15 * 60, repeats: false)");
    expect(coordinator).not.toContain("UNCalendarNotificationTrigger");
  });
});
