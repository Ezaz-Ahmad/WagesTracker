import { readFile, writeFile } from "node:fs/promises";

const packageFile = new URL("../../ios/App/CapApp-SPM/Package.swift", import.meta.url);
const source = await readFile(packageFile, "utf8");
const project = await readFile(new URL("../../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
const deploymentTargets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
if (!deploymentTargets.length) throw new Error("Cannot determine the app's minimum iOS deployment target.");
// Capacitor reads the first target, which can be the iOS 16.1 widget. The
// shared package must also support the app's existing iOS 15 deployment.
const minimumMajor = Math.floor(Math.min(...deploymentTargets));
const normalized = source.replace(/platforms: \[\.iOS\(\.v\d+\)\]/, `platforms: [.iOS(.v${minimumMajor})]`).replace(/path: "([^"]+)"/g, (_match, packagePath) =>
  `path: "${packagePath.replaceAll("\\", "/")}"`
);

if (normalized !== source) {
  await writeFile(packageFile, normalized, "utf8");
  console.log("Normalized Swift package paths and deployment target for cross-platform builds.");
}
