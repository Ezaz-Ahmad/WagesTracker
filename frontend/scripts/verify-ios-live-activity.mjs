import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const [project, appInfo, extensionInfo, widget, intent, coordinator, appDelegate] = await Promise.all([
  read("ios/App/App.xcodeproj/project.pbxproj"),
  read("ios/App/App/Info.plist"),
  read("ios/App/ShiftActivityExtension/Info.plist"),
  read("ios/App/ShiftActivityExtension/ShiftActivityWidget.swift"),
  read("ios/App/App/EndShiftIntent.swift"),
  read("ios/App/App/ShiftActivityCoordinator.swift"),
  read("ios/App/App/AppDelegate.swift"),
]);

function requireMatch(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(`iOS Live Activity check failed: ${message}`);
}

requireMatch(appInfo, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/u, "app Info.plist must enable Live Activities");
requireMatch(extensionInfo, /com\.apple\.widgetkit-extension/u, "widget extension point is missing");
requireMatch(extensionInfo, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/u, "extension Info.plist must enable Live Activities");
for (const key of [
  "CFBundleExecutable",
  "CFBundleIdentifier",
  "CFBundleInfoDictionaryVersion",
  "CFBundleName",
  "CFBundlePackageType",
  "CFBundleShortVersionString",
  "CFBundleVersion",
]) {
  requireMatch(extensionInfo, new RegExp(`<key>${key}<\\/key>`), `extension Info.plist is missing ${key}`);
}
requireMatch(project, /PBXNativeTarget[\s\S]*name = ShiftActivityExtension;/u, "ShiftActivityExtension target is missing");
requireMatch(project, /ShiftActivityExtension\.appex in Embed App Extensions/u, "Live Activity extension is not embedded in the app");
for (const file of ["ShiftActivityBundle", "ShiftActivityWidget", "ShiftActivityAttributes", "EndShiftIntent"]) {
  requireMatch(project, new RegExp(`${file}\\.swift in Sources`), `${file}.swift is not compiled into a required target`);
}
requireMatch(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.ezazahmad\.wagestracker\.ShiftActivityExtension;/u, "extension bundle id is incorrect");
requireMatch(project, /IPHONEOS_DEPLOYMENT_TARGET = 16\.1;/u, "extension must target iOS 16.1 or later");
requireMatch(widget, /ActivityConfiguration\(for: ShiftActivityAttributes\.self\)/u, "ActivityKit configuration is missing");
requireMatch(widget, /Text\(\s*timerInterval:/u, "system-rendered elapsed timer is missing");
requireMatch(widget, /Text\(attributes\.startedAt, style: \.time\)/u, "visible shift start time is missing");
requireMatch(widget, /ProgressView\(timerInterval:/u, "system-driven hourly chart is missing");
if (/TimelineView\s*\(|Timer\.scheduledTimer|\.onReceive\s*\(/u.test(widget)) {
  throw new Error("iOS Live Activity check failed: lock-screen time must use system-rendered controls, not app timers");
}
requireMatch(widget, /Label\("End Shift", systemImage: "stop\.fill"\)/u, "clear End Shift action is missing");
requireMatch(widget, /preferredColorScheme\(preferredColorScheme\(context\.state\.appearance\)\)/u, "Live Activity appearance must follow the app preference");
requireMatch(widget, /Button\(intent: RequestShiftSignOutIntent/u, "interactive Sign Out action is missing");
requireMatch(widget, /Button\(intent: CancelShiftSignOutIntent/u, "in-activity Sign Out cancellation is missing");
requireMatch(widget, /Button\(intent: EndShiftIntent/u, "confirmed Sign Out action is missing");
requireMatch(intent, /struct RequestShiftSignOutIntent: LiveActivityIntent/u, "Sign Out confirmation intent is missing");
requireMatch(intent, /struct EndShiftIntent: LiveActivityIntent/u, "shift-ending LiveActivityIntent is missing");
if (/requestConfirmation\s*\(/u.test(intent)) {
  throw new Error("iOS Live Activity check failed: Sign Out must use the visible in-activity confirmation state");
}
requireMatch(coordinator, /phase: \.confirming/u, "visible Sign Out confirmation state is missing");
requireMatch(coordinator, /URLSessionConfiguration\.background/u, "durable offline clock-out queue is missing");
requireMatch(coordinator, /X-Shift-Clock-Out-Token/u, "scoped clock-out token header is missing");
requireMatch(appDelegate, /handleEventsForBackgroundURLSession/u, "background URLSession relaunch handling is missing");

console.log("Verified the adaptive Live Activity, system timer and hourly chart, start time, two-step End Shift action, scoped credential, and background retry wiring.");
