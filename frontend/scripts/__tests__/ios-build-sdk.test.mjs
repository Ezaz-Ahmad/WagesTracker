import assert from "node:assert/strict";
import test from "node:test";
import { verifyBuildSdk, verifySceneLifecycle } from "../lib/ios-build-sdk.mjs";

test("accepts compiled device and Simulator artifacts built with iOS 27 or newer", () => {
  for (const sdk of ["iphoneos27.2", "iphonesimulator27.2", "iphoneos28.0"]) assert.equal(verifyBuildSdk(sdk), sdk);
});
test("accepts the compiled single-scene Capacitor storyboard configuration", () => {
  assert.equal(verifySceneLifecycle({ UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneDelegateClassName: "App.SceneDelegate", UISceneStoryboardFile: "Main" }] } } }), true);
});
test("rejects legacy launch configuration even when a new SDK would compile it", () => {
  for (const info of [{}, { UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: true } }, { UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: {} } }]) assert.throws(() => verifySceneLifecycle(info), /iOS 27 launch requirement/);
});
test("rejects the obsolete SDK in Apple's ITMS-90725 warning and missing or unrelated metadata", () => {
  for (const sdk of ["iphoneos26.5", "iphonesimulator26.6", "macosx27.2", "", undefined]) assert.throws(() => verifyBuildSdk(sdk), /App Store SDK requirement/);
});
