export const MINIMUM_IOS_SDK = 27;

export function verifyBuildSdk(sdkName) {
  const match = /^(iphoneos|iphonesimulator)(\d+)(?:\.\d+)*$/.exec(String(sdkName));
  if (!match || Number(match[2]) < MINIMUM_IOS_SDK) {
    throw new Error(`App Store SDK requirement: expected iOS ${MINIMUM_IOS_SDK} or later; built artifact reports ${String(sdkName)}. Use the selected stable Xcode 27 toolchain.`);
  }
  return String(sdkName);
}

export function verifySceneLifecycle(info) {
  const manifest = info?.UIApplicationSceneManifest;
  const scenes = manifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
  if (manifest?.UIApplicationSupportsMultipleScenes !== false || !Array.isArray(scenes) || scenes.length !== 1 ||
      scenes[0].UISceneDelegateClassName !== "App.SceneDelegate" || scenes[0].UISceneStoryboardFile !== "Main") {
    throw new Error("iOS 27 launch requirement: the compiled app must use its single SceneDelegate and Main bridge storyboard");
  }
  return true;
}
