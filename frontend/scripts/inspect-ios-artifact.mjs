import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const appPath = process.argv[2];
if (!appPath) throw new Error("Usage: node inspect-ios-artifact.mjs <path-to-App.app>");

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(appPath);
const names = files.map((path) => basename(path));
const manifests = files.filter((path) => basename(path) === "PrivacyInfo.xcprivacy");
if (!manifests.some((path) => path === join(appPath, "PrivacyInfo.xcprivacy"))) {
  throw new Error("The application privacy manifest is missing from the .app root");
}

const publicFiles = files.filter((path) => path.includes(`${join(appPath, "public")}`));
const relativePublicFiles = publicFiles.map((path) => path.slice(join(appPath, "public").length + 1));
const unexpectedDevelopmentFiles = relativePublicFiles.filter((path) =>
  /(?:^|\/)(?:node_modules|src)(?:\/|$)|\.(?:map|ts|tsx|env)$|(?:^|\/)(?:package(?:-lock)?\.json|vite\.config\.[^.]+)$/iu.test(path),
);
if (unexpectedDevelopmentFiles.length > 0) {
  throw new Error(`Development-only files found in native bundle: ${unexpectedDevelopmentFiles.join(", ")}`);
}
const searchable = await Promise.all(publicFiles
  .filter((path) => /\.(?:js|json|html|css)$/.test(path))
  .map((path) => readFile(path, "utf8")));
const bundle = searchable.join("\n");
const bundleOrigins = new Set((bundle.match(/https?:\/\/[^\s"'`\\<>]+/gu) ?? []).flatMap((candidate) => {
  try { return [new URL(candidate).origin]; }
  catch { return []; }
}));
const productionApiOrigin = new URL("https://wage-tracker-api.onrender.com").origin;
if (!bundleOrigins.has(productionApiOrigin)) throw new Error("Production API URL missing from native web bundle");
for (const forbiddenOrigin of ["http://localhost:4000", "http://localhost:5173"]) {
  if (bundleOrigins.has(new URL(forbiddenOrigin).origin)) {
    throw new Error(`Development configuration found in native bundle: ${forbiddenOrigin}`);
  }
}
if (bundle.includes("VITE_CAPACITOR_SERVER_URL")) {
  throw new Error("Development configuration found in native bundle: VITE_CAPACITOR_SERVER_URL");
}
for (const [marker, description] of [
  ["wageTracker.adminToken", "admin bundle"],
  ["/api/admin", "admin API"],
  ["Wage Tracker viewport diagnostics", "viewport-debug overlay"],
  ["VITE_VIEWPORT_DEBUG", "viewport-debug configuration"],
  ["allowsAnyHTTPSCertificateForHost", "certificate-validation bypass"],
  ["NSURLAuthenticationMethodServerTrust", "certificate-validation bypass"],
]) {
  if (bundle.includes(marker)) throw new Error(`${description} found in native bundle`);
}
for (const marker of ["CapacitorCustomPlatform", "Cannot register plugins twice."]) {
  const count = bundle.split(marker).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one Capacitor runtime marker ${marker}; received ${count}`);
}

const pluginsFile = files.find((path) => basename(path) === "capacitor.config.json");
if (!pluginsFile) throw new Error("capacitor.config.json missing from built app");
const pluginsText = await readFile(pluginsFile, "utf8");
const capacitorConfig = JSON.parse(pluginsText);
if (capacitorConfig.server?.url) throw new Error("Capacitor live-reload server.url found in native artifact");
for (const plugin of ["AppPlugin", "FilesystemPlugin", "CAPNetworkPlugin", "SharePlugin", "SecureStorage"]) {
  if (!pluginsText.includes(plugin)) throw new Error(`Expected native plugin missing: ${plugin}`);
}

const permissionKeys = ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription", "NSLocationWhenInUseUsageDescription"];
const infoText = execFileSync("plutil", ["-p", join(appPath, "Info.plist")], { encoding: "utf8" });
for (const permission of permissionKeys) {
  if (infoText.includes(permission)) throw new Error(`Unnecessary permission declaration found: ${permission}`);
}
for (const atsKey of ["NSAllowsArbitraryLoads", "NSAllowsArbitraryLoadsInWebContent", "NSExceptionAllowsInsecureHTTPLoads"]) {
  const result = spawnSync("plutil", ["-extract", atsKey, "raw", "-o", "-", join(appPath, "Info.plist")], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim() === "true") {
    throw new Error(`Broad App Transport Security exception enabled: ${atsKey}`);
  }
}

console.log(JSON.stringify({
  app: appPath,
  productionApi: true,
  localhostConfiguration: false,
  adminBundle: false,
  viewportDebugOverlay: false,
  broadAtsException: false,
  certificateValidationBypass: false,
  capacitorRuntimeCount: 1,
  developmentFiles: [],
  privacyManifests: manifests.map((path) => path.slice(appPath.length + 1)),
  expectedPlugins: true,
  protectedResourcePermissions: [],
  appIcon: names.includes("AppIcon60x60@2x.png") || names.some((name) => name.startsWith("AppIcon")),
}, null, 2));
