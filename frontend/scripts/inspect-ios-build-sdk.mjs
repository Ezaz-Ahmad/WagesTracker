import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { verifyBuildSdk } from "./lib/ios-build-sdk.mjs";

const appPath = process.argv[2];
if (!appPath) throw new Error("Usage: node inspect-ios-build-sdk.mjs <path-to-App.app>");
const inspect = path => verifyBuildSdk(execFileSync("plutil", ["-extract", "DTSDKName", "raw", "-o", "-", path], { encoding: "utf8" }).trim());
const appSdk = inspect(join(appPath, "Info.plist"));
const widgetSdk = inspect(join(appPath, "PlugIns", "ShiftActivityExtension.appex", "Info.plist"));
console.log(JSON.stringify({ appSdk, widgetSdk, minimumSdk: 27, appStoreSdkRequirement: true }, null, 2));
