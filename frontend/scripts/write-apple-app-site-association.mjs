import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relativePath = path.join(".well-known", "apple-app-site-association");
const source = path.join(frontendRoot, "public", relativePath);
const destination = path.join(frontendRoot, "dist", relativePath);
const placeholder = "$(APPLE_TEAM_ID)";
const teamId = process.env.APPLE_TEAM_ID?.trim();
const template = await readFile(source, "utf8");

if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) {
  console.error("[universal-links] APPLE_TEAM_ID must be the 10-character Team ID from the Apple Developer account.");
  process.exit(1);
}

const output = teamId ? template.split(placeholder).join(teamId) : template;
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, output, "utf8");
JSON.parse(output);

if (teamId) {
  console.log(`[universal-links] Apple association file written for Team ID ${teamId}.`);
} else {
  console.warn(
    "[universal-links] APPLE_TEAM_ID is unset. Reset links still work in the responsive web page, but will not open the installed iPhone app directly."
  );
}
