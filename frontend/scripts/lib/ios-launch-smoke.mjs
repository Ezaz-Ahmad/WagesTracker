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
    await delay(10_000);
    assertAlive(initialPid);
    screenshot("cold-launch.png");
    run("xcrun", ["simctl", "launch", deviceId, "com.apple.Preferences"]);
    await delay(1500);
    const resumedPid = pidFrom(run("xcrun", ["simctl", "launch", deviceId, bundleId]));
    await delay(1500);
    assertAlive(resumedPid);
    if (resumedPid !== initialPid) throw new Error("The app restarted instead of resuming its existing scene");
    screenshot("resumed.png");
    // An unsupported, harmless route must still reach the scene and leave the
    // app usable; account recovery tokens are never used in this test.
    run("xcrun", ["simctl", "terminate", deviceId, bundleId]);
    run("xcrun", ["simctl", "openurl", deviceId, "wagestracker://native-launch-check"]);
    await delay(5000);
    const linkedPid = pidFrom(run("xcrun", ["simctl", "launch", deviceId, bundleId]));
    assertAlive(linkedPid);
    screenshot("cold-link-launch.png");
    const result = { coldLaunch: true, resumedWithoutRestart: true, coldCustomUrlLaunch: true };
    writeFileSync(path.join(output, "launch-results.json"), JSON.stringify(result, null, 2));
    console.log("Verified native cold launch, scene resume and custom-URL cold launch; inspect the captured app screenshots.");
  } finally { run("xcrun", ["simctl", "uninstall", deviceId, bundleId]); }
}
