import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertDistributionEntitlements } from "./lib/ios-distribution-entitlements.mjs";

const appPath = process.argv[2];
if (!appPath) throw new Error("Usage: node inspect-ios-distribution.mjs <path-to-App.app>");

const expected = {
  bundleId: process.env.IOS_BUNDLE_ID,
  version: process.env.IOS_APP_VERSION,
  build: process.env.IOS_BUILD_NUMBER,
  teamId: process.env.APPLE_TEAM_ID,
  profileName: process.env.IOS_PROVISIONING_PROFILE_NAME,
  associatedDomain: "applinks:wages-tracker-frontend.vercel.app",
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

function plistDocumentJson(plist) {
  return JSON.parse(command("plutil", ["-convert", "json", "-o", "-", plist]));
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
  assertDistributionEntitlements(plistJson(profilePlist, "Entitlements"), expected, "profile");
  for (const forbiddenKey of ["ProvisionedDevices", "ProvisionsAllDevices"]) {
    const result = spawnSync("plutil", ["-extract", forbiddenKey, "raw", "-o", "-", profilePlist], { encoding: "utf8" });
    if (result.status === 0) throw new Error(`App Store profile unexpectedly contains ${forbiddenKey}`);
  }

  const entitlementResult = spawnSync("codesign", ["-d", "--entitlements", ":-", appPath], { encoding: "utf8" });
  if (entitlementResult.status !== 0) throw new Error(`Unable to inspect signed entitlements: ${entitlementResult.stderr}`);
  await writeFile(entitlementsPlist, entitlementResult.stdout, { mode: 0o600 });
  assertDistributionEntitlements(plistDocumentJson(entitlementsPlist), expected, "signed application");

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
  associatedDomainsEntitlement: expected.associatedDomain,
  nonExemptEncryption: false,
}, null, 2));
