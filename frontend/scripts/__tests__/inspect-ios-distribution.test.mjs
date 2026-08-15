import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertDistributionEntitlements } from "../lib/ios-distribution-entitlements.mjs";

if (process.platform !== "darwin") {
  throw new Error("The distribution plist regression suite must run on macOS with plutil");
}

const expected = {
  bundleId: "com.ezazahmad.wagestracker",
  teamId: "XYN7FY5RB8",
};

function fixtureEntitlements(name) {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(execFileSync("plutil", ["-extract", "Entitlements", "json", "-o", "-", path], {
    encoding: "utf8",
  }));
}

function plistDocument(name) {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], {
    encoding: "utf8",
  }));
}

test("accepts correct literal dotted entitlement keys", () => {
  assert.doesNotThrow(() => assertDistributionEntitlements(
    fixtureEntitlements("distribution-entitlements-correct.plist"),
    expected,
    "profile",
  ));
});

test("accepts literal dotted keys from signed application entitlements", () => {
  assert.doesNotThrow(() => assertDistributionEntitlements(
    plistDocument("signed-entitlements-correct.plist"),
    expected,
    "signed application",
  ));
});

test("rejects each missing required entitlement", () => {
  const fixture = fixtureEntitlements("distribution-entitlements-correct.plist");
  for (const key of [
    "application-identifier",
    "com.apple.developer.team-identifier",
    "beta-reports-active",
  ]) {
    const entitlements = { ...fixture };
    delete entitlements[key];
    assert.throws(
      () => assertDistributionEntitlements(entitlements, expected, "profile"),
      new RegExp(`missing required entitlement ${key.replaceAll(".", "\\.")}`, "u"),
    );
  }

  assert.throws(
    () => assertDistributionEntitlements(
      fixtureEntitlements("distribution-entitlements-missing.plist"),
      expected,
      "profile",
    ),
    /missing required entitlement com\.apple\.developer\.team-identifier/u,
  );
});

test("rejects each incorrect distribution entitlement value", () => {
  const fixture = fixtureEntitlements("distribution-entitlements-correct.plist");
  for (const [key, value] of [
    ["application-identifier", "WRONGTEAM.com.ezazahmad.wagestracker"],
    ["com.apple.developer.team-identifier", "WRONGTEAM"],
    ["beta-reports-active", false],
    ["get-task-allow", true],
  ]) {
    assert.throws(
      () => assertDistributionEntitlements({ ...fixture, [key]: value }, expected, "profile"),
      /profile (?:application identifier|entitlement team|TestFlight entitlement|debug entitlement)/u,
    );
  }

  assert.throws(
    () => assertDistributionEntitlements(
      fixtureEntitlements("distribution-entitlements-incorrect.plist"),
      expected,
      "profile",
    ),
    /profile application identifier/u,
  );
});

test("rejects a misleading nested structure in place of a literal dotted key", () => {
  assert.throws(
    () => assertDistributionEntitlements(
      fixtureEntitlements("distribution-entitlements-misleading-nested.plist"),
      expected,
      "profile",
    ),
    /missing required entitlement com\.apple\.developer\.team-identifier/u,
  );
});
