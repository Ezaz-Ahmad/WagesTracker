/** Native visual QA on macOS: compile the actual SwiftUI view into a temporary
 * simulator app, render all states, and enforce ActivityKit's 160pt limit. */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smokeNativeLaunch } from "./lib/ios-launch-smoke.mjs";

if (process.platform !== "darwin") throw new Error("Live Activity rendering requires macOS and Xcode.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "test-results/ios-live-activity");
const app = path.join(output, "LiveActivityPreview.app");
const bundleId = "com.ezazahmad.wagestracker.liveactivitypreview";
const run = (command, args, timeout = 180_000) => {
  console.log(`Running ${command} ${args.join(" ")}`);
  return execFileSync(command, args, { cwd: root, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "inherit"] }).trim();
};
mkdirSync(app, { recursive: true });
writeFileSync(path.join(app, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleExecutable</key><string>LiveActivityPreview</string>
<key>CFBundleName</key><string>LiveActivityPreview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>17.0</string>
<key>UILaunchScreen</key><dict/>
<key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict><key>UIWindowSceneSessionRoleApplication</key><array><dict><key>UISceneConfigurationName</key><string>Preview</string><key>UISceneDelegateClassName</key><string>LiveActivityPreview.LiveActivityPreviewScene</string></dict></array></dict></dict>
</dict></plist>`);
const sdk = run("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]);
run("xcrun", ["--sdk", "iphonesimulator", "swiftc", "-sdk", sdk,
  "-module-name", "LiveActivityPreview",
  "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-ios17.0-simulator`,
  "-D", "WIDGET_EXTENSION", "-parse-as-library",
  "ios/App/App/ShiftActivityAttributes.swift", "ios/App/App/EndShiftIntent.swift",
  "ios/App/ShiftActivityExtension/ShiftActivityWidget.swift", "frontend/scripts/ios-live-activity-preview.swift",
  "-o", path.join(app, "LiveActivityPreview")]);
run("codesign", ["--force", "--sign", "-", app]);
const { devices } = JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "--json"]));
const phones = Object.entries(devices).filter(([runtime]) => runtime.includes("iOS"))
  .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
  .flatMap(([runtime, entries]) => entries.map(entry => ({ ...entry, runtime })))
  .filter(entry => entry.name.startsWith("iPhone"));
// Prefer a conventional phone viewport; the Duo's two display surfaces need
// separate visual coverage and are not representative of the standard phone.
const device = phones.find(entry => entry.name === "iPhone 18 Pro")
  ?? phones.find(entry => /^iPhone \d/.test(entry.name)) ?? phones[0];
if (!device) throw new Error("No available iPhone simulator.");
console.log(`Using ${device.name} (${device.runtime}) for native visual QA.`);
const bootedHere = device.state !== "Booted";
try {
  if (bootedHere) run("xcrun", ["simctl", "boot", device.udid]);
  run("xcrun", ["simctl", "bootstatus", device.udid, "-b"], 600_000);
  run("xcrun", ["simctl", "install", device.udid, app]);
  let launchError;
  try {
    console.log(run("xcrun", ["simctl", "launch", "--console", device.udid, bundleId]));
  } catch (error) { launchError = error; }
  const container = run("xcrun", ["simctl", "get_app_container", device.udid, bundleId, "data"]);
  cpSync(path.join(container, "Documents"), path.join(output, "screenshots"), { recursive: true });
  const results = JSON.parse(readFileSync(path.join(output, "screenshots/layout-results.json"), "utf8"));
  const failures = results.filter((result) => !result.fitsLiveActivity);
  if (failures.length) throw new Error(`Live Activity layouts exceed 160pt: ${JSON.stringify(failures)}`);
  if (launchError) throw launchError;
  if (results.length !== 40) throw new Error(`Expected 40 rendered layouts; got ${results.length}.`);
  console.log(`Verified ${results.length} native layouts; screenshots: ${output}/screenshots`);
  await smokeNativeLaunch({ run, deviceId: device.udid, appPath: path.join(root, "ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app"), output: path.join(root, "test-results/ios-app-launch") });
} finally {
  run("xcrun", ["simctl", "uninstall", device.udid, bundleId]);
  if (bootedHere) run("xcrun", ["simctl", "shutdown", device.udid]);
}
