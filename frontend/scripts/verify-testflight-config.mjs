import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

async function source(path) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

function requireMatch(value, pattern, description) {
  if (!pattern.test(value)) throw new Error(`TestFlight configuration invalid: ${description}`);
}

function requireAbsent(value, pattern, description) {
  if (pattern.test(value)) throw new Error(`TestFlight configuration invalid: ${description}`);
}

const [workflow, infoPlist, project, frontendPackage, lockfile, nativeConfig, capacitorConfig, appDelegate] = await Promise.all([
  source(".github/workflows/ios-testflight.yml"),
  source("ios/App/App/Info.plist"),
  source("ios/App/App.xcodeproj/project.pbxproj"),
  source("frontend/package.json").then(JSON.parse),
  source("package-lock.json").then(JSON.parse),
  source("frontend/src/config/nativeReleaseConfig.ts"),
  source("frontend/capacitor.config.ts"),
  source("ios/App/App/AppDelegate.swift"),
]);

requireMatch(workflow, /^on:\s*\n\s+workflow_dispatch:\s*\{?\}?\s*$/mu, "workflow must expose only workflow_dispatch");
requireAbsent(workflow, /^\s+(?:push|pull_request|schedule):/mu, "signed delivery must not run for pushes, PRs or schedules");
requireMatch(workflow, /github\.event_name == 'workflow_dispatch'.*github\.ref == 'refs\/heads\/main'.*github\.event\.repository\.fork == false/su, "job must be guarded to a manual run on non-fork protected main");
requireMatch(workflow, /permissions:\s*\n\s+contents: read\s*$/mu, "workflow permissions must be read-only");
requireAbsent(workflow, /^\s+\S+: write\s*$/mu, "workflow must not request write permissions");
requireMatch(workflow, /environment:\s*\n\s+name: testflight/mu, "job must use the testflight environment");
requireMatch(workflow, /concurrency:\s*\n\s+group: testflight-production\s*\n\s+cancel-in-progress: false/mu, "production delivery must be serialized without cancellation");
requireAbsent(workflow, /actions\/upload-artifact/iu, "signed IPA files must never be uploaded as GitHub artifacts");
requireAbsent(workflow, /\bset\s+-x\b|\bprintenv\b|\benv\s*\|/u, "workflow must not enable shell tracing or dump its environment");

for (const secret of [
  "ASC_KEY_ID",
  "ASC_ISSUER_ID",
  "ASC_API_KEY_P8_BASE64",
  "IOS_DISTRIBUTION_P12_BASE64",
  "IOS_DISTRIBUTION_P12_PASSWORD",
  "IOS_APP_STORE_PROFILE_BASE64",
]) {
  requireMatch(workflow, new RegExp(`secrets\\.${secret}\\b`, "u"), `missing environment secret reference ${secret}`);
}
const allowedSecrets = new Set([
  "ASC_KEY_ID",
  "ASC_ISSUER_ID",
  "ASC_API_KEY_P8_BASE64",
  "IOS_DISTRIBUTION_P12_BASE64",
  "IOS_DISTRIBUTION_P12_PASSWORD",
  "IOS_APP_STORE_PROFILE_BASE64",
]);
for (const match of workflow.matchAll(/secrets\.([A-Z0-9_]+)/gu)) {
  if (!allowedSecrets.has(match[1])) throw new Error(`TestFlight configuration invalid: unexpected secret reference ${match[1]}`);
}

for (const variable of [
  "IOS_BUNDLE_ID",
  "IOS_APP_VERSION",
  "APPLE_TEAM_ID",
  "IOS_PROVISIONING_PROFILE_NAME",
]) {
  requireMatch(workflow, new RegExp(`vars\\.${variable}\\b`, "u"), `missing environment variable reference ${variable}`);
}

for (const requiredStep of [
  /npm ci/u,
  /npm run ios:testflight:verify -w frontend/u,
  /npm run typecheck\b/u,
  /npm run test\b/u,
  /npm run build\b/u,
  /npm run verify:capacitor\b/u,
  /npm run ios:assets -w frontend/u,
  /npm run ios:assets:verify -w frontend/u,
  /npm run ios:sync\b/u,
  /npm run verify:capacitor:bundle\b/u,
  /security create-keychain/u,
  /security import/u,
  /xcodebuild[\s\S]*archive/u,
  /xcodebuild -exportArchive/u,
  /inspect-ios-artifact\.mjs/u,
  /inspect-ios-distribution\.mjs/u,
  /altool --validate-app/u,
  /altool --upload-app/u,
  /if: always\(\)/u,
  /security delete-keychain/u,
  /AuthKey_\$\{ASC_KEY_ID\}\.p8/u,
  /wagestracker-app-store\.mobileprovision/u,
  /wagestracker-distribution\.p12/u,
]) {
  requireMatch(workflow, requiredStep, `missing required delivery safeguard: ${requiredStep}`);
}

requireMatch(workflow, /GITHUB_RUN_NUMBER.*GITHUB_RUN_ATTEMPT/u, "build number must be unique for every workflow attempt");
requireMatch(workflow, /IOS_BUILD_NUMBER=.*GITHUB_RUN_NUMBER.*GITHUB_RUN_ATTEMPT/u, "build number must be derived monotonically from run number and attempt");
requireMatch(workflow, /MARKETING_VERSION="\$IOS_APP_VERSION"/u, "archive must receive the environment marketing version");
requireMatch(workflow, /CURRENT_PROJECT_VERSION="\$IOS_BUILD_NUMBER"/u, "archive must receive the unique build number");
requireMatch(workflow, /CODE_SIGN_STYLE=Manual/u, "archive must use explicit manual signing");
requireMatch(workflow, /CODE_SIGN_IDENTITY="Apple Distribution"/u, "archive must use Apple Distribution signing");
requireMatch(workflow, /method[\s\S]*app-store-connect/u, "export must target App Store Connect");

if (frontendPackage.version !== "1.16.0" || lockfile.packages?.frontend?.version !== "1.16.0") {
  throw new Error("TestFlight configuration invalid: frontend and lockfile versions must remain 1.16.0");
}
for (const pattern of [
  /MARKETING_VERSION = 1\.16\.0;/u,
  /PRODUCT_BUNDLE_IDENTIFIER = com\.ezazahmad\.wagestracker;/u,
  /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/u,
  /TARGETED_DEVICE_FAMILY = 1;/u,
]) {
  requireMatch(project, pattern, `Xcode release invariant missing: ${pattern}`);
}
requireMatch(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/u, "export-compliance declaration must be false after the documented audit");
requireAbsent(infoPlist, /NSAllowsArbitraryLoads|NSExceptionAllowsInsecureHTTPLoads/u, "broad ATS exceptions are forbidden");
requireMatch(nativeConfig, /PRODUCTION_API_URL = "https:\/\/wage-tracker-api\.onrender\.com"/u, "native API must remain pinned to production HTTPS");
requireMatch(nativeConfig, /Viewport debugging must be disabled/u, "native viewport diagnostics guard is required");
requireAbsent(capacitorConfig, /server\s*:/u, "production Capacitor configuration must not contain server.url");
requireAbsent(appDelegate, /allowsAnyHTTPSCertificateForHost|NSURLAuthenticationMethodServerTrust|serverTrust|SecTrustEvaluate/u, "application source must not bypass certificate validation");

const trackedCredentialFiles = execFileSync("git", [
  "ls-files",
  "*.p12",
  "*.mobileprovision",
  "AuthKey_*.p8",
  "*.ipa",
], { cwd: repositoryRoot, encoding: "utf8" }).trim();
if (trackedCredentialFiles) {
  throw new Error(`TestFlight configuration invalid: signing or distribution material is tracked: ${trackedCredentialFiles}`);
}

console.log("Verified manual-main TestFlight trigger, secret boundaries, signing/upload safeguards, release metadata and native production invariants.");
