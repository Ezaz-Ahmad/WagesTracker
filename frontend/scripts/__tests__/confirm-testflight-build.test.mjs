import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { appleClient, APPLE_APP_ID, confirmTestFlight, INTERNAL_GROUP, signedToken, verifyAppleApplication } from "../confirm-testflight-build.mjs";

const app = { id: APPLE_APP_ID, attributes: { bundleId: "com.ezazahmad.wagestracker" } };

function fixture({ version = "1.24.0", platform = "IOS", internal = true, automatic = false, assigned = false, processing = "VALID", internalState = "IN_BETA_TESTING" } = {}) {
  const writes = [];
  const request = async (path, method = "GET", body) => {
    if (method === "POST") { writes.push({ path, body }); assigned = true; return {}; }
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    if (url.pathname === "/v1/apps") return { data: [app] };
    if (url.pathname === "/v1/builds") return {
      data: [{ id: "build", attributes: { version: "53", processingState: processing }, relationships: { preReleaseVersion: { data: { id: "release" } } } }],
      included: [{ id: "release", type: "preReleaseVersions", attributes: { version, platform } }],
    };
    if (url.pathname === `/v1/apps/${APPLE_APP_ID}/betaGroups`) return { data: [{ id: "internal-group", attributes: { name: INTERNAL_GROUP, isInternalGroup: internal, hasAccessToAllBuilds: automatic } }] };
    if (url.pathname === "/v1/builds/build/betaGroups") return { data: assigned ? [{ id: "internal-group" }] : [] };
    if (url.pathname === "/v1/builds/build/buildBetaDetail") return { data: { attributes: { internalBuildState: internalState } } };
    throw new Error(`Unexpected request: ${path}`);
  };
  return { request, writes };
}
const run = source => confirmTestFlight({ ...source, version: "1.24.0", buildNumber: "53", log: () => {} });

test("preflight resolves only the existing Apple app using a read-only bundle lookup", async () => {
  const id = await verifyAppleApplication(async (path, method) => {
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    assert.equal(method, undefined);
    assert.equal(url.pathname, "/v1/apps");
    assert.equal(url.searchParams.get("filter[bundleId]"), app.attributes.bundleId);
    assert.equal(url.searchParams.get("limit"), "2");
    return { data: [app] };
  });
  assert.equal(id, APPLE_APP_ID);
});

test("refuses missing, ambiguous or mismatched Apple app identities before distribution", async () => {
  for (const data of [[], [app, app], [{ ...app, id: "different-app" }], [{ ...app, attributes: { bundleId: "com.other.app" } }]]) {
    const writes = [];
    await assert.rejects(run({ request: async (path, method) => { if (method) writes.push(method); return { data }; } }), /exactly one|identity/);
    assert.deepEqual(writes, []);
  }
});

test("assigns only the exact processed build to the existing internal group and verifies readiness", async () => {
  const source = fixture();
  assert.equal((await run(source)).internalState, "IN_BETA_TESTING");
  assert.deepEqual(source.writes, [{ path: "/v1/betaGroups/internal-group/relationships/builds", body: { data: [{ type: "builds", id: "build" }] } }]);
});
test("does not write when the build is already assigned", async () => {
  const source = fixture({ assigned: true });
  await run(source);
  assert.deepEqual(source.writes, []);
});
test("checks automatic internal distribution without modifying build relationships", async () => {
  const source = fixture({ automatic: true });
  const result = await run({ assignBuild: false, request: async (...args) => {
    if (args[1] || args[0].includes("/builds/build/betaGroups")) throw new Error("Automatic groups must not be modified or require explicit membership");
    return source.request(...args);
  } });
  assert.equal(result.internalState, "IN_BETA_TESTING");
  assert.deepEqual(source.writes, []);
});
test("read-only recovery refuses to assign an unassigned manual group", async () => {
  const source = fixture();
  await assert.rejects(run({ ...source, assignBuild: false }), /read-only confirmation/);
  assert.deepEqual(source.writes, []);
});
test("refuses a mismatched marketing version or non-iOS build before any write", async () => {
  for (const options of [{ version: "1.23.1" }, { platform: "MAC_OS" }]) {
    const source = fixture(options);
    await assert.rejects(run(source), /version\/platform/);
    assert.deepEqual(source.writes, []);
  }
});
test("refuses external groups and failed Apple processing", async () => {
  for (const options of [{ internal: false }, { processing: "FAILED" }]) {
    const source = fixture(options);
    await assert.rejects(run(source), /internal tester group|rejected/);
    assert.deepEqual(source.writes, []);
  }
});
test("reports export compliance issues instead of claiming phone availability", async () => {
  await assert.rejects(run(fixture({ assigned: true, internalState: "MISSING_EXPORT_COMPLIANCE" })), /requires attention.*MISSING_EXPORT_COMPLIANCE/);
});
test("waits through Apple's processing delay without uploading another binary", async () => {
  const ready = fixture();let waiting = true;
  const request = async (...args) => {
    if (waiting && args[0].startsWith("/v1/builds?")) return { data: [] };
    return ready.request(...args);
  };
  await run({ request, sleep: async () => { waiting = false; } });
  assert.equal(ready.writes.length, 1);
});
test("stops after the processing deadline without changing tester access", async () => {
  const source = fixture({ processing: "PROCESSING" });let now = 0;
  await assert.rejects(run({ ...source, now: () => now, timeoutMs: 1, sleep: async () => { now = 2; } }), /do not upload it again/);
  assert.deepEqual(source.writes, []);
});
test("creates a verifiable short-lived ES256 token and confines credentials to Apple", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const token = signedToken("TESTKEY123", "test-issuer", privateKey, 1_000_000);
  const [header, payload, signature] = token.split(".");
  assert.equal(verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.exp - claims.iat, 300);
  const request = appleClient({ keyId: "TESTKEY123", issuerId: "test-issuer", privateKey, fetchImpl: () => { throw new Error("Network must not be reached"); } });
  await assert.rejects(request("https://example.com/v1/apps"), /non-Apple/);
});

test("reports Apple's agreement error code without response details or credentials", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const request = appleClient({ keyId: "TESTKEY123", issuerId: "private-issuer", privateKey, fetchImpl: async () => ({
    ok: false, status: 403, json: async () => ({ errors: [{ code: "FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED", detail: "private account data" }, { code: "private-issuer\n" }] }),
  }) });
  await assert.rejects(request("/v1/apps"), error => {
    assert.equal(error.status, 403);
    assert.match(error.message, /REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED/);
    assert.match(error.message, /GET \/v1\/apps failed \(403\)/);
    assert.doesNotMatch(error.message, /private account|private-issuer|TESTKEY/);
    return true;
  });
});
