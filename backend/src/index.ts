import "dotenv/config";
import { createApp } from "./app.js";
import { db, pruneExpiredShifts } from "./db.js";
import { waitForPendingPasswordResetEmails } from "./routes/passwordReset.js";

// Last-resort safety net: every route already goes through asyncHandler (see
// asyncHandler.ts), which turns a rejected route handler into a normal 500
// response instead of an unhandled rejection — but that only covers the
// request/response cycle. Anything outside it (a stray rejected promise a
// future change forgets to await/catch, a bug in a background task) would
// otherwise either crash the whole process — taking down every logged-in
// user's session, not just the one request that misbehaved — or fail
// silently. Logging and staying up trades a small risk of running past a
// truly corrupted state for a much larger, likelier win: one bad request
// doesn't take the whole API offline for everyone else.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandled rejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaught exception]", err);
});

const app = createApp();

await pruneExpiredShifts();
setInterval(() => {
  void pruneExpiredShifts().catch((e) => console.error("[prune] failed:", e));
}, 24 * 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT) || 4000;
const server = app.listen(PORT, () => {
  console.log(`Wage Tracker API listening on http://localhost:${PORT}`);
});

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    try {
      // Forgot-password responses intentionally do not wait on email delivery.
      // Give work already accepted by this process a chance to finish before
      // closing its database connection during a deploy or normal shutdown.
      await waitForPendingPasswordResetEmails();
    } finally {
      db.close();
      process.exit(0);
    }
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
