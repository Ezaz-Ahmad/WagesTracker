import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Run the real built Capacitor app in this isolated Simulator. No account
 * is created and no private links, credentials or production records are used. */
export async function smokeNativeLaunch({ run, deviceId, appPath, output }) {
  const bundleId = "com.ezazahmad.wagestracker";
  const delay = ms => new Promise(done => setTimeout(done, ms));
  const pidFrom = text => {
    const pid = Number(/:\s*(\d+)\s*$/.exec(text)?.[1]);
    if (!pid) throw new Error("Simulator did not return the application PID");
    return pid;
  };
  const assertAlive = pid => { try { process.kill(pid, 0); } catch { throw new Error("The iOS app terminated during its launch/resume smoke check"); } };
  // Newer iPhone Simulators can expose more than one display. Capture the
  // primary display explicitly so screenshot collection is unambiguous.
  const screenshot = name => run("xcrun", ["simctl", "io", deviceId, "screenshot", "--display=1", path.join(output, name)]);
  mkdirSync(output, { recursive: true });
  run("xcrun", ["simctl", "install", deviceId, appPath]);
  try {
    const initialPid = pidFrom(run("xcrun", ["simctl", "launch", "--terminate-running-process", deviceId, bundleId]));
    // Give a newly booted hosted Simulator time to start its first WebKit
    // process before collecting evidence of the rendered application.
    await delay(45_000);
    assertAlive(initialPid);
    screenshot("cold-launch.png");
    run("xcrun", ["simctl", "launch", deviceId, "com.apple.Preferences"]);
    await delay(1500);
    const resumedPid = pidFrom(run("xcrun", ["simctl", "launch", deviceId, bundleId]));
    await delay(1500);
    assertAlive(resumedPid);
    if (resumedPid !== initialPid) throw new Error("The app restarted instead of resuming its existing scene");
    screenshot("resumed.png");
    // Capture the OS handling of a harmless custom URL. iOS can present an
    // Open confirmation here; this does not assert delivery past that prompt.
    // Account recovery tokens are never used in this test.
    run("xcrun", ["simctl", "terminate", deviceId, bundleId]);
    run("xcrun", ["simctl", "openurl", deviceId, "wagestracker://native-launch-check"]);
    await delay(5000);
    const linkedPid = pidFrom(run("xcrun", ["simctl", "launch", deviceId, bundleId]));
    assertAlive(linkedPid);
    screenshot("custom-url-request.png");
    const result = { coldLaunch: true, resumedWithoutRestart: true, customUrlRequestCaptured: true };
    writeFileSync(path.join(output, "launch-results.json"), JSON.stringify(result, null, 2));
    console.log("Verified native cold launch and scene resume; inspect the app screenshots and custom-URL system prompt capture.");
  } finally { run("xcrun", ["simctl", "uninstall", deviceId, bundleId]); }
}
