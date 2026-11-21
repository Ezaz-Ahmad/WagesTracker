// Guards the exact regression a code review caught in the biometric-login
// PR: `BiometricAuthPlugin.swift` conforming to `CAPBridgedPlugin` makes the
// class *discoverable*, but Capacitor's own docs
// (https://capacitorjs.com/docs/ios/custom-code,
// https://capacitorjs.com/docs/ios/viewcontroller) are explicit that an
// app-local plugin (one compiled directly into the App target, not pulled in
// as its own Cocoapod/SPM package) is only ever registered with the bridge
// by a custom `CAPBridgeViewController` subclass calling
// `bridge?.registerPluginInstance(...)` from `capacitorDidLoad()` — and by
// SceneDelegate actually creating that subclass instead of the framework's
// own `CAPBridgeViewController`.
//
// None of that requires compiling Swift, so this runs as plain text/JSON
// checks against the checked-in project files — on every push, on a Linux
// runner, with no Xcode needed — rather than waiting to be caught only once
// a macOS runner (ios-simulator.yml) actually builds the app.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');

function fail(message) {
  console.error(`iOS plugin registration check failed: ${message}`);
  process.exit(1);
}

async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

const pbxproj = await read('ios/App/App.xcodeproj/project.pbxproj');
const sceneSource = await read('ios/App/App/SceneDelegate.swift');
const appDelegateSource = await read('ios/App/App/AppDelegate.swift');

// The PBXBuildFile entry's own trailing comment reads "X.swift in Sources"
// (that's just Xcode's comment convention for that section) — matching that
// string anywhere in the whole file would make the "is it actually in the
// Sources build phase" check pass even if the build-file id were never
// added to PBXSourcesBuildPhase's `files = (...)` list. Scope the search to
// that section specifically so removing just the membership line is caught.
const sourcesBuildPhaseMatch = pbxproj.match(
  /\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//,
);
if (!sourcesBuildPhaseMatch) {
  fail('project.pbxproj has no PBXSourcesBuildPhase section.');
}
const sourcesBuildPhaseSection = sourcesBuildPhaseMatch[1];

// 1. Each app-local plugin file must actually be compiled into the target —
//    a file merely existing on disk under ios/App/App/ does not put it in
//    the Xcode project at all, let alone the Sources build phase.
function checkCompiled(pluginClassName) {
  const pluginFileRefMatch = pbxproj.match(
    new RegExp(`([A-F0-9]{24}) /\\* ${pluginClassName}\\.swift \\*/ = \\{isa = PBXFileReference;`),
  );
  if (!pluginFileRefMatch) {
    fail(`${pluginClassName}.swift has no PBXFileReference in project.pbxproj — it is not part of the Xcode project.`);
  }
  const pluginFileRefId = pluginFileRefMatch[1];
  if (
    !new RegExp(`isa = PBXBuildFile; fileRef = ${pluginFileRefId} /\\* ${pluginClassName}\\.swift \\*/`).test(pbxproj)
  ) {
    fail(`${pluginClassName}.swift has no PBXBuildFile entry — it is referenced by the project but not compiled.`);
  }
  if (!new RegExp(`${pluginClassName}\\.swift in Sources \\*/`).test(sourcesBuildPhaseSection)) {
    fail(`${pluginClassName}.swift's build file is not listed in the target's Sources build phase.`);
  }
}

checkCompiled('BiometricAuthPlugin');
checkCompiled('ActiveShiftActivityPlugin');
checkCompiled('SceneDelegate');
const applicationInfo = await read('ios/App/App/Info.plist');
if (!applicationInfo.includes('UIApplicationSceneManifest') || !applicationInfo.includes('$(PRODUCT_MODULE_NAME).SceneDelegate') || /UISceneStoryboardFile|UIMainStoryboardFile/.test(applicationInfo)) {
  fail('The iOS 27 scene lifecycle must use SceneDelegate with one programmatically owned window.');
}
if (!appDelegateSource.includes('configuration.delegateClass = SceneDelegate.self') || !sceneSource.includes('UIWindow(windowScene: windowScene)') || !sceneSource.includes('makeKeyAndVisible()') || !sceneSource.includes('session.role == .windowApplication')) {
  fail('AppDelegate must select SceneDelegate, which must create and present only the application window.');
}

// 2. A bridge view controller subclass must exist, be compiled into the
//    target the same way, and actually call registerPluginInstance with
//    each plugin — CAPBridgedPlugin conformance alone is not registration
//    (see the file-level comment above).
const compiledSwiftFiles = [...pbxproj.matchAll(/\/\* (\w+)\.swift \*\/ = \{isa = PBXFileReference;/g)].map((m) => m[1]);
const knownPluginNames = ['BiometricAuthPlugin', 'ActiveShiftActivityPlugin'];
const candidateControllers = compiledSwiftFiles.filter(
  (name) => !knownPluginNames.includes(name) && name !== 'AppDelegate',
);
if (candidateControllers.length === 0) {
  fail(
    'No custom bridge view controller Swift file is compiled into the target — the app-local plugins can never be registered without one (see https://capacitorjs.com/docs/ios/viewcontroller).',
  );
}

function findRegisteringController(pluginClassName) {
  return candidateControllers.find((name) => {
    // Synchronous lookup against an already-read cache built below.
    const source = swiftSources.get(name);
    return (
      source &&
      new RegExp(`registerPluginInstance\\(\\s*${pluginClassName}\\(\\)\\s*\\)`).test(source) &&
      /:\s*CAPBridgeViewController/.test(source)
    );
  });
}

const swiftSources = new Map();
for (const name of candidateControllers) {
  const source = await read(`ios/App/App/${name}.swift`).catch(() => null);
  swiftSources.set(name, source);
}

let registeringControllerName = null;
for (const pluginClassName of knownPluginNames) {
  const controllerName = findRegisteringController(pluginClassName);
  if (!controllerName) {
    fail(
      `None of the compiled custom Swift file(s) (${candidateControllers.join(', ')}) both subclass CAPBridgeViewController and call bridge?.registerPluginInstance(${pluginClassName}()) from capacitorDidLoad().`,
    );
  }
  if (!new RegExp(`${controllerName}\\.swift in Sources \\*/`).test(sourcesBuildPhaseSection)) {
    fail(`${controllerName}.swift registers ${pluginClassName} but is not listed in the target's Sources build phase.`);
  }
  registeringControllerName ??= controllerName;
  if (registeringControllerName !== controllerName) {
    fail(
      `${pluginClassName} and BiometricAuthPlugin must be registered by the same bridge controller.`,
    );
  }
}

// 3. The actual scene must instantiate the controller that registers plugins.
if (!new RegExp(`rootViewController\\s*=\\s*${registeringControllerName}\\(\\)`).test(sceneSource)) {
  fail(`SceneDelegate must instantiate ${registeringControllerName}, which registers the app-local plugins.`);
}

console.log(
  `Verified native plugins compile into the App target and SceneDelegate presents their registering ${registeringControllerName}.`,
);
