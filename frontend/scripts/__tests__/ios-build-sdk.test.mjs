import assert from "node:assert/strict";
import test from "node:test";
import { verifyBuildSdk } from "../lib/ios-build-sdk.mjs";

test("accepts compiled device and Simulator artifacts built with iOS 27 or newer", () => {
  for (const sdk of ["iphoneos27.2", "iphonesimulator27.2", "iphoneos28.0"]) assert.equal(verifyBuildSdk(sdk), sdk);
});
test("rejects the obsolete SDK in Apple's ITMS-90725 warning and missing or unrelated metadata", () => {
  for (const sdk of ["iphoneos26.5", "iphonesimulator26.6", "macosx27.2", "", undefined]) assert.throws(() => verifyBuildSdk(sdk), /App Store SDK requirement/);
});
