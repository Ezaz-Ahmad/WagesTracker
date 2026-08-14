import { readFile, writeFile } from "node:fs/promises";

const packageFile = new URL("../../ios/App/CapApp-SPM/Package.swift", import.meta.url);
const source = await readFile(packageFile, "utf8");
const normalized = source.replace(/path: "([^"]+)"/g, (_match, packagePath) =>
  `path: "${packagePath.replaceAll("\\", "/")}"`
);

if (normalized !== source) {
  await writeFile(packageFile, normalized, "utf8");
  console.log("Normalized local Swift package paths for cross-platform builds.");
}
