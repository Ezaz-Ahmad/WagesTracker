import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDistributionEntitlements } from "../lib/ios-distribution-entitlements.mjs";

const expected = {
  bundleId: "com.ezazahmad.wagestracker",
  teamId: "XYN7FY5RB8",
  associatedDomain: "applinks:wages-tracker-frontend.vercel.app",
};

function fixtureEntitlements(name) {
  const fixtures = {
    correct: {
      "application-identifier": "XYN7FY5RB8.com.ezazahmad.wagestracker",
      "com.apple.developer.team-identifier": "XYN7FY5RB8",
      "beta-reports-active": true,
      "com.apple.developer.associated-domains": ["applinks:wages-tracker-frontend.vercel.app"],
      "get-task-allow": false,
    },
    incorrect: {
      "application-identifier": "WRONGTEAM.com.ezazahmad.wagestracker",
      "com.apple.developer.team-identifier": "WRONGTEAM",
      "beta-reports-active": false,
      "com.apple.developer.associated-domains": ["applinks:wages-tracker-frontend.vercel.app"],
      "get-task-allow": true,
    },
    misleadingNested: {
      "application-identifier": "XYN7FY5RB8.com.ezazahmad.wagestracker",
      com: { apple: { developer: { "team-identifier": "XYN7FY5RB8" } } },
      "beta-reports-active": true,
    },
    missing: {
      "application-identifier": "XYN7FY5RB8.com.ezazahmad.wagestracker",
      "beta-reports-active": true,
    },
    signedApplication: {
      "application-identifier": "XYN7FY5RB8.com.ezazahmad.wagestracker",
      "com.apple.developer.team-identifier": "XYN7FY5RB8",
      "beta-reports-active": true,
      "com.apple.developer.associated-domains": ["applinks:wages-tracker-frontend.vercel.app"],
    },
  };

  return structuredClone(fixtures[name]);
}

test("accepts correct literal dotted entitlement keys", () => {
  assert.doesNotThrow(() => assertDistributionEntitlements(
    fixtureEntitlements("correct"),
    expected,
    "profile",
  ));
});

test("accepts literal dotted keys from signed application entitlements", () => {
  assert.doesNotThrow(() => assertDistributionEntitlements(
    fixtureEntitlements("signedApplication"),
    expected,
    "signed application",
  ));
});

test("rejects each missing required entitlement", () => {
  const fixture = fixtureEntitlements("correct");
  for (const key of [
    "application-identifier",
    "com.apple.developer.team-identifier",
    "beta-reports-active",
    "com.apple.developer.associated-domains",
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
      fixtureEntitlements("missing"),
      expected,
      "profile",
    ),
    /missing required entitlement com\.apple\.developer\.team-identifier/u,
  );
});

test("rejects each incorrect distribution entitlement value", () => {
  const fixture = fixtureEntitlements("correct");
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
      fixtureEntitlements("incorrect"),
      expected,
      "profile",
    ),
    /profile application identifier/u,
  );
});

test("rejects a misleading nested structure in place of a literal dotted key", () => {
  assert.throws(
    () => assertDistributionEntitlements(
      fixtureEntitlements("misleadingNested"),
      expected,
      "profile",
    ),
    /missing required entitlement com\.apple\.developer\.team-identifier/u,
  );
});

test("rejects a profile or signed app without the production Universal Link domain", () => {
  const fixture = fixtureEntitlements("correct");
  assert.throws(
    () => assertDistributionEntitlements(
      { ...fixture, "com.apple.developer.associated-domains": ["applinks:example.invalid"] },
      expected,
      "profile",
    ),
    /Associated Domains entitlement must include applinks:wages-tracker-frontend\.vercel\.app/u,
  );
});
