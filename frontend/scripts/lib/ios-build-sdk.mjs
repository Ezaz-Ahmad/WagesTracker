export const MINIMUM_IOS_SDK = 27;

export function verifyBuildSdk(sdkName) {
  const match = /^(iphoneos|iphonesimulator)(\d+)(?:\.\d+)*$/.exec(String(sdkName));
  if (!match || Number(match[2]) < MINIMUM_IOS_SDK) {
    throw new Error(`App Store SDK requirement: expected iOS ${MINIMUM_IOS_SDK} or later; built artifact reports ${String(sdkName)}. Use the selected stable Xcode 27 toolchain.`);
  }
  return String(sdkName);
}
