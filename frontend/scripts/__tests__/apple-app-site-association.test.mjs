import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPLE_TEAM_ID_PLACEHOLDER,
  renderAppleAppSiteAssociation,
} from "../lib/apple-app-site-association.mjs";

const template = JSON.stringify({
  applinks: { details: [{ appIDs: [`${APPLE_TEAM_ID_PLACEHOLDER}.com.ezazahmad.wagestracker`] }] },
});

test("writes a literal Apple application identifier", () => {
  const { output, configured } = renderAppleAppSiteAssociation(template, { teamId: "XYN7FY5RB8", requireTeamId: true });
  assert.equal(configured, true);
  assert.match(output, /XYN7FY5RB8\.com\.ezazahmad\.wagestracker/u);
  assert.doesNotMatch(output, /APPLE_TEAM_ID/u);
});

test("rejects a missing Team ID for production hosting", () => {
  assert.throws(
    () => renderAppleAppSiteAssociation(template, { requireTeamId: true }),
    /required for a production Vercel deployment/u,
  );
});

test("rejects malformed Team IDs", () => {
  assert.throws(
    () => renderAppleAppSiteAssociation(template, { teamId: "wrong" }),
    /10-character Team ID/u,
  );
});
