import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const assetRoots = ["frontend/assets", "ios/App/App/Assets.xcassets"];

export const REQUIRED_DIMENSIONS = new Map([
  ["frontend/assets/icon-only.png", [1024, 1024]],
  ["frontend/assets/splash.png", [2732, 2732]],
  ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", [1024, 1024]],
  ["ios/App/App/Assets.xcassets/Splash.imageset/Default@1x~universal~anyany.png", [2732, 2732]],
  ["ios/App/App/Assets.xcassets/Splash.imageset/Default@2x~universal~anyany.png", [2732, 2732]],
  ["ios/App/App/Assets.xcassets/Splash.imageset/Default@3x~universal~anyany.png", [2732, 2732]],
]);

function portable(path) { return path.split(sep).join("/"); }

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(portable(relative(repositoryRoot, path)));
  }
  return files;
}

export function assertExactFileSet(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((path) => !actualSet.has(path));
  const unexpected = actual.filter((path) => !expectedSet.has(path));
  if (missing.length || unexpected.length) {
    throw new Error(`iOS asset file set changed. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`);
  }
}

export async function decodeRgba(buffer) {
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

export async function assertSameDecodedPng(path, committed, generated, options = {}) {
  const [before, after] = await Promise.all([decodeRgba(committed), decodeRgba(generated)]);
  const beforeSize = [before.info.width, before.info.height];
  const afterSize = [after.info.width, after.info.height];
  if (beforeSize[0] !== afterSize[0] || beforeSize[1] !== afterSize[1]) {
    throw new Error(`${path}: dimensions changed from ${beforeSize.join("x")} to ${afterSize.join("x")}`);
  }
  const required = options.requiredDimensions;
  if (required && (afterSize[0] !== required[0] || afterSize[1] !== required[1])) {
    throw new Error(`${path}: expected ${required.join("x")}, received ${afterSize.join("x")}`);
  }
  if (!before.data.equals(after.data)) throw new Error(`${path}: decoded RGBA pixel data differs`);
  if (options.requireOpaque) {
    for (let offset = 3; offset < after.data.length; offset += 4) {
      if (after.data[offset] !== 255) throw new Error(`${path}: production app icon contains transparency`);
    }
  }
}

async function verifyRepositoryAssets() {
  const committedFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", ...assetRoots], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim().split(/\r?\n/).filter(Boolean).sort();
  const generatedFiles = (await Promise.all(assetRoots.map((root) => walk(resolve(repositoryRoot, root))))).flat().sort();
  assertExactFileSet(committedFiles, generatedFiles);

  for (const path of committedFiles) {
    const committed = execFileSync("git", ["show", `HEAD:${path}`], { cwd: repositoryRoot, encoding: null, maxBuffer: 32 * 1024 * 1024 });
    const generated = await readFile(resolve(repositoryRoot, path));
    if (path.endsWith(".png")) {
      await assertSameDecodedPng(path, committed, generated, {
        requiredDimensions: REQUIRED_DIMENSIONS.get(path),
        requireOpaque: path.includes("/AppIcon.appiconset/"),
      });
    } else if (!committed.equals(generated)) {
      throw new Error(`${path}: non-image asset changed byte-for-byte`);
    }
  }
  console.log(`Verified ${committedFiles.length} iOS brand files: exact file set, RGBA pixels, dimensions, opacity and non-image bytes.`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await verifyRepositoryAssets();
