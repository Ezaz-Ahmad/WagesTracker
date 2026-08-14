import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const expectedVersion = '8.4.2';
const alignedPackages = ['@capacitor/core', '@capacitor/ios'];

function fail(message) {
  console.error(`Capacitor alignment check failed: ${message}`);
  process.exit(1);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
}

const rootManifest = await readJson('package.json');
const frontendManifest = await readJson('frontend/package.json');
const lockfile = await readJson('package-lock.json');

for (const packageName of alignedPackages) {
  if (rootManifest.overrides?.[packageName] !== expectedVersion) {
    fail(`${packageName} must be overridden to ${expectedVersion} at the workspace root.`);
  }

  if (frontendManifest.dependencies?.[packageName] !== expectedVersion) {
    fail(`frontend must depend directly on ${packageName}@${expectedVersion}.`);
  }

  const lockEntries = Object.entries(lockfile.packages).filter(([installPath]) =>
    installPath.endsWith(`node_modules/${packageName}`),
  );

  if (lockEntries.length === 0) {
    fail(`${packageName} is missing from package-lock.json.`);
  }

  for (const [installPath, metadata] of lockEntries) {
    if (metadata.version !== expectedVersion) {
      fail(`${installPath} resolves to ${metadata.version}, expected ${expectedVersion}.`);
    }
  }
}

const packageResolved = await readJson('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
const capacitorSwift = packageResolved.pins?.find((pin) => pin.identity === 'capacitor-swift-pm');
if (capacitorSwift?.state?.version !== expectedVersion) {
  fail(`Swift runtime resolves to ${capacitorSwift?.state?.version || 'missing'}, expected ${expectedVersion}.`);
}

const bundleRoots = process.argv.slice(2).flatMap((argument, index, arguments_) =>
  argument === '--bundle' && arguments_[index + 1] ? [arguments_[index + 1]] : [],
);

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listJavaScriptFiles(entryPath)
      : entry.name.endsWith('.js') ? [entryPath] : [];
  }));
  return files.flat();
}

for (const relativeBundleRoot of bundleRoots) {
  const bundleRoot = path.join(repositoryRoot, relativeBundleRoot);
  const files = await listJavaScriptFiles(bundleRoot);
  const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  const bundle = sources.join('\n');
  const bootstrapMarkers = ['CapacitorCustomPlatform', 'Cannot register plugins twice.'];

  for (const marker of bootstrapMarkers) {
    const count = bundle.split(marker).length - 1;
    if (count !== 1) {
      fail(`${relativeBundleRoot} contains ${count} copies of the Capacitor bootstrap marker "${marker}"; expected one.`);
    }
  }
}

console.log(`Capacitor JavaScript and Swift dependencies are aligned on ${expectedVersion}.`);
if (bundleRoots.length > 0) {
  console.log(`Verified one Capacitor runtime bootstrap in: ${bundleRoots.join(', ')}.`);
}
