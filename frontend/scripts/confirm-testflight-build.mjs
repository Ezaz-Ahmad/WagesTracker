import { sign } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APPLE_API = "https://api.appstoreconnect.apple.com";
const BUNDLE_ID = "com.ezazahmad.wagestracker";
export const APPLE_APP_ID = "6801702467";
export const INTERNAL_GROUP = "WagesTracker Internal Testers";

// Apple JWT and TestFlight relationship APIs:
// https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
// https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-builds
export function signedToken(keyId, issuerId, privateKey, now = Date.now()) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issued = Math.floor(now / 1000);
  const unsigned = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode({ iss: issuerId, iat: issued, exp: issued + 300, aud: "appstoreconnect-v1" })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

export function appleClient({ keyId, issuerId, privateKey, fetchImpl = fetch }) {
  return async (path, method = "GET", body) => {
    const url = new URL(path, APPLE_API);
    if (url.origin !== APPLE_API || !url.pathname.startsWith("/v1/")) throw new Error("Refusing a non-Apple API destination");
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${signedToken(keyId, issuerId, privateKey)}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      // Report Apple's bounded error codes only; response details may contain
      // account data and must never enter Actions logs.
      const codes = (failure.errors ?? []).map(error => error.code).filter(code => typeof code === "string" && /^[A-Z0-9_.]{1,100}$/.test(code)).slice(0, 3);
      throw Object.assign(new Error(`App Store Connect request failed (${response.status})${codes.length ? `: ${codes.join(", ")}` : ""}. Credentials were not logged.`), { status: response.status });
    }
    return response.status === 204 ? {} : response.json();
  };
}

export async function verifyAppleApplication(request) {
  const apps = await request(`/v1/apps?${new URLSearchParams({ "filter[bundleId]": BUNDLE_ID, limit: "2" })}`);
  if (apps.data?.length !== 1) throw new Error("Expected exactly one WagesTracker application");
  const app = apps.data[0];
  if (app.id !== APPLE_APP_ID || app.attributes?.bundleId !== BUNDLE_ID) throw new Error("Apple application identity does not match the existing WagesTracker app; refusing delivery");
  return app.id;
}

/** Operates on one exact build and the pre-existing internal group only.
 * Does not create groups/testers, change notification preferences, submit
 * beta review, select an App Store version or release an app publicly. */
export async function confirmTestFlight({ request, version, buildNumber, now = Date.now, sleep = ms => new Promise(done => setTimeout(done, ms)), timeoutMs = 20 * 60_000, log = console.log }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d*$/.test(String(buildNumber))) throw new Error("Invalid release version or build number");
  const appId = await verifyAppleApplication(request);
  const deadline = now() + timeoutMs;
  let previous = "";
  while (now() < deadline) {
    try {
      const result = await request(`/v1/builds?${new URLSearchParams({ "filter[app]": appId, "filter[version]": String(buildNumber), include: "preReleaseVersion", limit: "10" })}`);
      const matches = (result.data ?? []).filter(build => String(build.attributes.version) === String(buildNumber));
      if (matches.length > 1) throw new Error("Build number is ambiguous; refusing to distribute");
      const build = matches[0];
      let state = build?.attributes.processingState ?? "AWAITING_APPLE_PROCESSING";
      if (build) {
        const releaseId = build.relationships?.preReleaseVersion?.data?.id;
        const release = result.included?.find(item => item.type === "preReleaseVersions" && item.id === releaseId);
        if (!release || release.attributes.version !== version || release.attributes.platform !== "IOS") throw new Error("Apple build version/platform does not match this release; refusing to distribute");
        if (["FAILED", "INVALID"].includes(state) || build.attributes.expired) throw new Error(`Apple rejected or expired the uploaded build (${state})`);
        if (state === "VALID") {
          const groups = await request(`/v1/apps/${encodeURIComponent(appId)}/betaGroups?limit=200`);
          const target = (groups.data ?? []).filter(group => group.attributes.name === INTERNAL_GROUP && group.attributes.isInternalGroup === true);
          if (target.length !== 1) throw new Error("The existing WagesTracker internal tester group was not found unambiguously");
          const membership = await request(`/v1/builds/${encodeURIComponent(build.id)}/betaGroups?limit=200`);
          if (!(membership.data ?? []).some(group => group.id === target[0].id)) {
            await request(`/v1/betaGroups/${encodeURIComponent(target[0].id)}/relationships/builds`, "POST", { data: [{ type: "builds", id: build.id }] });
            log(`Assigned ${version} (${buildNumber}) to the existing internal tester group.`);
          }
          const confirmed = await request(`/v1/builds/${encodeURIComponent(build.id)}/betaGroups?limit=200`);
          const detail = await request(`/v1/builds/${encodeURIComponent(build.id)}/buildBetaDetail`);
          state = detail.data?.attributes.internalBuildState ?? "WAITING_FOR_INTERNAL_TESTING";
          if ((confirmed.data ?? []).some(group => group.id === target[0].id) && ["IN_BETA_TESTING", "READY_FOR_BETA_TESTING"].includes(state)) {
            log(`TestFlight ready: ${version} (${buildNumber}); processing VALID; internal state ${state}; group ${INTERNAL_GROUP}.`);
            return { version, buildNumber: String(buildNumber), buildId: build.id, appId, group: INTERNAL_GROUP, internalState: state };
          }
          if (["EXPIRED", "PROCESSING_EXCEPTION", "MISSING_EXPORT_COMPLIANCE", "IN_EXPORT_COMPLIANCE_REVIEW"].includes(state)) throw new Error(`Internal testing requires attention in App Store Connect (${state})`);
        }
      }
      if (state !== previous) { log(`Waiting for Apple: ${version} (${buildNumber}) — ${state}.`); previous = state; }
    } catch (error) {
      if (!(error.status === 429 || error.status >= 500)) throw error;
      log(`Apple returned ${error.status}; retrying the processing check.`);
    }
    await sleep(15_000);
  }
  throw new Error("Apple has not confirmed internal availability within 20 minutes. The upload may still be processing; do not upload it again.");
}

async function main() {
  const env = process.env;
  const mode = process.argv[2];
  if (mode && mode !== "--preflight") throw new Error("Unknown TestFlight command");
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_RUN_ATTEMPT !== "1" || env.IOS_BUNDLE_ID !== BUNDLE_ID) throw new Error("TestFlight confirmation is restricted to a fresh protected-main delivery");
  if (!/^[A-Z0-9]{10}$/.test(env.ASC_KEY_ID ?? "") || !/^[0-9a-f-]{36}$/i.test(env.ASC_ISSUER_ID ?? "")) throw new Error("App Store Connect credentials are not configured");
  const privateKey = await readFile(join(homedir(), ".appstoreconnect", "private_keys", `AuthKey_${env.ASC_KEY_ID}.p8`), "utf8");
  const request = appleClient({ keyId: env.ASC_KEY_ID, issuerId: env.ASC_ISSUER_ID, privateKey });
  if (mode === "--preflight") {
    if (!env.GITHUB_ENV) throw new Error("GitHub environment file is unavailable");
    const appId = await verifyAppleApplication(request);
    await appendFile(env.GITHUB_ENV, `IOS_APPLE_ID=${appId}\n`);
    console.log(`Verified existing Apple application ${appId} (${BUNDLE_ID}) before signing. Validation and upload will use this explicit app ID.`);
    return;
  }
  await confirmTestFlight({ request, version: env.IOS_APP_VERSION, buildNumber: env.IOS_BUILD_NUMBER });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
