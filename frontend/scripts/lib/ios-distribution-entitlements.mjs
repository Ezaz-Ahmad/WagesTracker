const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function requiredEntitlement(entitlements, key, source) {
  if (!entitlements || typeof entitlements !== "object" || Array.isArray(entitlements)) {
    throw new Error(`${source} entitlements must be a dictionary`);
  }
  if (!hasOwn(entitlements, key)) {
    throw new Error(`${source} is missing required entitlement ${key}`);
  }
  return entitlements[key];
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${expected}, received ${actual}`);
  }
}

export function assertDistributionEntitlements(entitlements, expected, source) {
  const applicationIdentifier = requiredEntitlement(entitlements, "application-identifier", source);
  const teamIdentifier = requiredEntitlement(entitlements, "com.apple.developer.team-identifier", source);
  const betaReportsActive = requiredEntitlement(entitlements, "beta-reports-active", source);
  const associatedDomains = requiredEntitlement(entitlements, "com.apple.developer.associated-domains", source);

  assertEqual(
    applicationIdentifier,
    `${expected.teamId}.${expected.bundleId}`,
    `${source} application identifier`,
  );
  assertEqual(teamIdentifier, expected.teamId, `${source} entitlement team`);
  assertEqual(betaReportsActive, true, `${source} TestFlight entitlement`);
  const profileWildcard = source === "profile" && associatedDomains === "*";
  if (!profileWildcard && (!Array.isArray(associatedDomains) || !associatedDomains.includes(expected.associatedDomain))) {
    throw new Error(
      `${source} Associated Domains entitlement must include ${expected.associatedDomain}`,
    );
  }

  if (hasOwn(entitlements, "get-task-allow")) {
    assertEqual(entitlements["get-task-allow"], false, `${source} debug entitlement`);
  }
}
