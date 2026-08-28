import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAppleAppSiteAssociation } from "./lib/apple-app-site-association.mjs";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relativePath = path.join(".well-known", "apple-app-site-association");
const source = path.join(frontendRoot, "public", relativePath);
const destination = path.join(frontendRoot, "dist", relativePath);
const teamId = process.env.APPLE_TEAM_ID?.trim();
const template = await readFile(source, "utf8");
const requireTeamId = process.env.VERCEL_ENV === "production" || process.env.REQUIRE_APPLE_TEAM_ID === "true";
let output;
let configured;
try {
  ({ output, configured } = renderAppleAppSiteAssociation(template, { teamId, requireTeamId }));
} catch (error) {
  console.error(`[universal-links] ${error instanceof Error ? error.message : "Invalid Apple association configuration."}`);
  process.exit(1);
}
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, output, "utf8");

if (configured) {
  console.log(`[universal-links] Apple association file written for Team ID ${teamId}.`);
} else {
  console.warn(
    "[universal-links] APPLE_TEAM_ID is unset. Reset links still work in the responsive web page, but will not open the installed iPhone app directly."
  );
}
