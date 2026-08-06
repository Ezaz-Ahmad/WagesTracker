import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Stamps every build with the exact commit it was built from, so the app
// version showing in Settings (and on generated PDFs) always reflects
// what's actually running — no manual bump needed to know a build is
// current. `version` in package.json is separate and bumped by hand only
// for user-facing milestones (see package.json comment history / commits).
function safeGit(cmd: string, fallback: string): string {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const buildHash = safeGit("git rev-parse --short HEAD", "dev");
const buildDate = safeGit("git log -1 --format=%cI", new Date().toISOString());

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
