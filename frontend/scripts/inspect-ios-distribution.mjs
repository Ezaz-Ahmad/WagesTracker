import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const appPath = process.argv[2];
if (!appPath) throw new Error("Usage: node inspect-ios-distribution.mjs <path-to-App.app>");

const expected = {
  bundleId: process.env.IOS_BUNDLE_ID,
  version: process.env.IOS_APP_VERSION,
  build: process.env.IOS_BUILD_NUMBER,
  teamId: process.env.APPLE_TEAM_ID,
  profileName: process.env.IOS_PROVISIONING_PROFILE_NAME,
};
for (const [name, value] of Object.entries(expected)) {
  if (!value) throw new Error(`Missing required distribution inspection value: ${name}`);
}

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, { encoding: "utf8", ...options }).trim();
}

function plistRaw(plist, key) {
  return command("plutil", ["-extract", key, "raw", "-o", "-", plist]);
}

function plistJson(plist, key) {
  return JSON.parse(command("plutil", ["-extract", key, "json", "-o", "-", plist]));
}

function optionalPlistRaw(plist, key) {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function assertEqual(actual, wanted, description) {
  if (actual !== wanted) throw new Error(`${description}: expected ${wanted}, received ${actual}`);
}

const infoPlist = join(appPath, "Info.plist");
assertEqual(plistRaw(infoPlist, "CFBundleIdentifier"), expected.bundleId, "bundle identifier");
assertEqual(plistRaw(infoPlist, "CFBundleShortVersionString"), expected.version, "marketing version");
assertEqual(plistRaw(infoPlist, "CFBundleVersion"), expected.build, "build number");
assertEqual(plistRaw(infoPlist, "MinimumOSVersion"), "15.0", "minimum iOS version");
assertEqual(JSON.stringify(plistJson(infoPlist, "UIDeviceFamily")), JSON.stringify([1]), "device family");
assertEqual(JSON.stringify(plistJson(infoPlist, "CFBundleSupportedPlatforms")), JSON.stringify(["iPhoneOS"]), "supported platform");
assertEqual(plistRaw(infoPlist, "ITSAppUsesNonExemptEncryption"), "false", "non-exempt encryption declaration");

const signature = spawnSync("codesign", ["-dv", "--verbose=4", appPath], { encoding: "utf8" });
if (signature.status !== 0) throw new Error(`codesign inspection failed: ${signature.stderr}`);
const signatureDetails = `${signature.stdout}\n${signature.stderr}`;
for (const [pattern, description] of [
  [new RegExp(`Identifier=${expected.bundleId.replaceAll(".", "\\.")}\\b`, "u"), "signed bundle identifier"],
  [new RegExp(`TeamIdentifier=${expected.teamId}\\b`, "u"), "signing team"],
  [/Authority=Apple Distribution:/u, "Apple Distribution identity"],
]) {
  if (!pattern.test(signatureDetails)) throw new Error(`Incorrect ${description}`);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "wagestracker-distribution-"));
try {
  const profilePlist = join(temporaryDirectory, "embedded-profile.plist");
  const entitlementsPlist = join(temporaryDirectory, "signed-entitlements.plist");
  const profilePath = join(appPath, "embedded.mobileprovision");
  const profile = command("security", ["cms", "-D", "-i", profilePath]);
  await writeFile(profilePlist, profile, { mode: 0o600 });

  assertEqual(plistRaw(profilePlist, "Name"), expected.profileName, "provisioning profile name");
  assertEqual(plistRaw(profilePlist, "TeamIdentifier.0"), expected.teamId, "provisioning profile team");
  assertEqual(plistRaw(profilePlist, "Entitlements.application-identifier"), `${expected.teamId}.${expected.bundleId}`, "profile application identifier");
  assertEqual(plistRaw(profilePlist, "Entitlements.com.apple.developer.team-identifier"), expected.teamId, "profile entitlement team");
  assertEqual(plistRaw(profilePlist, "Entitlements.beta-reports-active"), "true", "TestFlight entitlement");
  const getTaskAllow = optionalPlistRaw(profilePlist, "Entitlements.get-task-allow");
  if (getTaskAllow !== undefined) assertEqual(getTaskAllow, "false", "debug entitlement");
  for (const forbiddenKey of ["ProvisionedDevices", "ProvisionsAllDevices"]) {
    const result = spawnSync("plutil", ["-extract", forbiddenKey, "raw", "-o", "-", profilePlist], { encoding: "utf8" });
    if (result.status === 0) throw new Error(`App Store profile unexpectedly contains ${forbiddenKey}`);
  }

  const entitlementResult = spawnSync("codesign", ["-d", "--entitlements", ":-", appPath], { encoding: "utf8" });
  if (entitlementResult.status !== 0) throw new Error(`Unable to inspect signed entitlements: ${entitlementResult.stderr}`);
  await writeFile(entitlementsPlist, entitlementResult.stdout, { mode: 0o600 });
  assertEqual(plistRaw(entitlementsPlist, "application-identifier"), `${expected.teamId}.${expected.bundleId}`, "signed application identifier");
  assertEqual(plistRaw(entitlementsPlist, "com.apple.developer.team-identifier"), expected.teamId, "signed entitlement team");
  assertEqual(plistRaw(entitlementsPlist, "beta-reports-active"), "true", "signed TestFlight entitlement");
  const signedGetTaskAllow = optionalPlistRaw(entitlementsPlist, "get-task-allow");
  if (signedGetTaskAllow !== undefined) assertEqual(signedGetTaskAllow, "false", "signed debug entitlement");

  const expiration = new Date(plistRaw(profilePlist, "ExpirationDate"));
  if (!Number.isFinite(expiration.valueOf()) || expiration <= new Date()) {
    throw new Error("Provisioning profile is expired or has an invalid expiration date");
  }

  const embeddedProfile = await readFile(profilePath);
  if (embeddedProfile.length === 0) throw new Error("Embedded provisioning profile is empty");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  bundleId: expected.bundleId,
  teamId: expected.teamId,
  profileName: expected.profileName,
  version: expected.version,
  build: expected.build,
  deviceFamily: "iPhone",
  minimumIos: "15.0",
  distributionIdentity: "Apple Distribution",
  testflightEntitlement: true,
  nonExemptEncryption: false,
}, null, 2));
