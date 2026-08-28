export const APPLE_TEAM_ID_PLACEHOLDER = "$(APPLE_TEAM_ID)";

export function renderAppleAppSiteAssociation(template, input = {}) {
  const teamId = input.teamId?.trim() || "";
  if (teamId && !/^[A-Z0-9]{10}$/u.test(teamId)) {
    throw new Error("APPLE_TEAM_ID must be the 10-character Team ID from the Apple Developer account.");
  }
  if (input.requireTeamId && !teamId) {
    throw new Error("APPLE_TEAM_ID is required for a production Vercel deployment; refusing to publish a placeholder Universal Link file.");
  }

  const output = teamId ? template.split(APPLE_TEAM_ID_PLACEHOLDER).join(teamId) : template;
  JSON.parse(output);
  if (teamId && output.includes(APPLE_TEAM_ID_PLACEHOLDER)) {
    throw new Error("The Apple association file still contains an unresolved Team ID placeholder.");
  }
  return { output, configured: Boolean(teamId) };
}
