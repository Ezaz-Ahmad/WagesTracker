import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

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
  const visualChecks = [];
  const screenshot = async (name, requireRenderedApp = false) => {
    const file = path.join(output, name);
    run("xcrun", ["simctl", "io", deviceId, "screenshot", "--display=1", file]);
    if (requireRenderedApp) {
      const stats = await sharp(file).resize({ width: 240 }).stats();
      const deviation = Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev));
      visualChecks.push({ file: name, deviation, minimumDeviation: 25, renderedContent: deviation >= 25 });
      writeFileSync(path.join(output, "visual-readiness.json"), JSON.stringify(visualChecks, null, 2));
      if (deviation < 25) throw new Error(`Native application UI is nearly empty in ${name}; inspect its screenshot and launch logs.`);
    }
  };
  mkdirSync(output, { recursive: true });
  run("xcrun", ["simctl", "install", deviceId, appPath]);
  try {
    const initialPid = pidFrom(run("xcrun", ["simctl", "launch", "--terminate-running-process", `--stdout=${path.join(output, "app-stdout.log")}`, `--stderr=${path.join(output, "app-stderr.log")}`, deviceId, bundleId]));
    // Give a newly booted hosted Simulator time to start its first WebKit
    // process before collecting evidence of the rendered application.
    await delay(45_000);
    assertAlive(initialPid);
    await screenshot("cold-launch.png", true);
    run("xcrun", ["simctl", "launch", deviceId, "com.apple.Preferences"]);
    await delay(5000);
    const resumedPid = pidFrom(run("xcrun", ["simctl", "launch", deviceId, bundleId]));
    await delay(5000);
    assertAlive(resumedPid);
    if (resumedPid !== initialPid) throw new Error("The app restarted instead of resuming its existing scene");
    await screenshot("resumed.png", true);
    // Capture the OS handling of a harmless custom URL. iOS can present an
    // Open confirmation here; this does not assert delivery past that prompt.
    // Account recovery tokens are never used in this test.
    run("xcrun", ["simctl", "terminate", deviceId, bundleId]);
    run("xcrun", ["simctl", "openurl", deviceId, "wagestracker://native-launch-check"]);
    await delay(5000);
    const linkedPid = pidFrom(run("xcrun", ["simctl", "launch", deviceId, bundleId]));
    assertAlive(linkedPid);
    await screenshot("custom-url-request.png");
    const result = { coldLaunch: true, renderedUi: true, resumedWithoutRestart: true, customUrlRequestCaptured: true };
    writeFileSync(path.join(output, "launch-results.json"), JSON.stringify(result, null, 2));
    console.log("Verified native cold launch and scene resume; inspect the app screenshots and custom-URL system prompt capture.");
  } finally { run("xcrun", ["simctl", "uninstall", deviceId, bundleId]); }
}
