import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const expectedVersion = "0.5.29";
const nativePackageName = "@libsql/darwin-arm64";
const nativeLockPath = "node_modules/@libsql/darwin-arm64";
const runtimeLockPath = "node_modules/libsql";
const expectedResolved = `https://registry.npmjs.org/@libsql/darwin-arm64/-/darwin-arm64-${expectedVersion}.tgz`;

async function readJson(path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(`libSQL dependency alignment invalid: ${description}; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertStringArray(actual, expected, description) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`libSQL dependency alignment invalid: ${description}; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const [manifest, lockfile, installedRuntime] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("node_modules/libsql/package.json"),
]);

const rootLock = lockfile.packages?.[""];
const runtimeLock = lockfile.packages?.[runtimeLockPath];
const nativeLock = lockfile.packages?.[nativeLockPath];

assertEqual(manifest.optionalDependencies?.[nativePackageName], expectedVersion, "root optional dependency must be exactly pinned");
assertEqual(rootLock?.optionalDependencies?.[nativePackageName], expectedVersion, "lockfile root optional dependency must match package.json");
assertEqual(installedRuntime.version, expectedVersion, "installed libSQL runtime version must match the native package");
assertEqual(installedRuntime.optionalDependencies?.[nativePackageName], expectedVersion, "installed libSQL runtime must request the aligned native package");
assertEqual(runtimeLock?.version, expectedVersion, "locked libSQL runtime version must match the native package");
assertEqual(runtimeLock?.optionalDependencies?.[nativePackageName], expectedVersion, "locked libSQL runtime must request the aligned native package");
assertEqual(nativeLock?.version, expectedVersion, "Darwin ARM64 lockfile package version must match the runtime");
assertEqual(nativeLock?.resolved, expectedResolved, "Darwin ARM64 lockfile package must use the expected registry artifact");
if (typeof nativeLock?.integrity !== "string" || !nativeLock.integrity.startsWith("sha512-")) {
  throw new Error("libSQL dependency alignment invalid: Darwin ARM64 lockfile package requires SHA-512 integrity metadata");
}
assertEqual(nativeLock?.optional, true, "Darwin ARM64 lockfile package must remain optional");
assertStringArray(nativeLock?.os, ["darwin"], "Darwin ARM64 lockfile package OS restriction is incorrect");
assertStringArray(nativeLock?.cpu, ["arm64"], "Darwin ARM64 lockfile package CPU restriction is incorrect");

if (process.platform === "darwin" && process.arch === "arm64") {
  const installedNative = await readJson("node_modules/@libsql/darwin-arm64/package.json");
  assertEqual(installedNative.version, expectedVersion, "installed Darwin ARM64 package version must match the runtime");
}

console.log(`Verified libSQL ${expectedVersion} and ${nativePackageName} ${expectedVersion} root, runtime, lockfile and platform alignment.`);
