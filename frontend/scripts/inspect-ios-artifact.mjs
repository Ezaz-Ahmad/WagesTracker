import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

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
const searchable = await Promise.all(publicFiles
  .filter((path) => /\.(?:js|json|html|css)$/.test(path))
  .map((path) => readFile(path, "utf8")));
const bundle = searchable.join("\n");
if (!bundle.includes("https://wage-tracker-api.onrender.com")) throw new Error("Production API URL missing from native web bundle");
for (const forbidden of ["http://localhost:4000", "http://localhost:5173", "VITE_CAPACITOR_SERVER_URL"]) {
  if (bundle.includes(forbidden)) throw new Error(`Development configuration found in native bundle: ${forbidden}`);
}

const pluginsFile = files.find((path) => basename(path) === "capacitor.config.json");
if (!pluginsFile) throw new Error("capacitor.config.json missing from built app");
const pluginsText = await readFile(pluginsFile, "utf8");
for (const plugin of ["AppPlugin", "FilesystemPlugin", "CAPNetworkPlugin", "SharePlugin", "SecureStorage"]) {
  if (!pluginsText.includes(plugin)) throw new Error(`Expected native plugin missing: ${plugin}`);
}

const permissionKeys = ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription", "NSLocationWhenInUseUsageDescription"];
const infoText = execFileSync("plutil", ["-p", join(appPath, "Info.plist")], { encoding: "utf8" });
for (const permission of permissionKeys) {
  if (infoText.includes(permission)) throw new Error(`Unnecessary permission declaration found: ${permission}`);
}

console.log(JSON.stringify({
  app: appPath,
  productionApi: true,
  localhostConfiguration: false,
  privacyManifests: manifests.map((path) => path.slice(appPath.length + 1)),
  expectedPlugins: true,
  protectedResourcePermissions: [],
  appIcon: names.includes("AppIcon60x60@2x.png") || names.some((name) => name.startsWith("AppIcon")),
}, null, 2));
