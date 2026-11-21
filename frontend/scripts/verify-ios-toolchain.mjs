import { execFileSync } from "node:child_process";
import { verifyBuildSdk } from "./lib/ios-build-sdk.mjs";

const xcode = execFileSync("xcodebuild", ["-version"], { encoding: "utf8" }).trim();
if (!/^Xcode 27\.2\r?$/m.test(xcode)) throw new Error(`Expected stable Xcode 27.2; selected toolchain reports ${xcode}`);
const sdk = execFileSync("xcrun", ["--sdk", "iphoneos", "--show-sdk-version"], { encoding: "utf8" }).trim();
verifyBuildSdk(`iphoneos${sdk}`);
console.log(`${xcode}\niOS build SDK ${sdk}; App Store minimum SDK requirement satisfied.`);
