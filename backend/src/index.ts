import cors from "cors";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { db, pruneExpiredShifts } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { shiftsRouter } from "./routes/shifts.js";

const isProd = process.env.NODE_ENV === "production";

// Comma-separated list of allowed browser origins, e.g. "https://app.example.com,https://staging.example.com"
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (isProd && allowedOrigins.length === 0) {
  console.warn(
    "[warn] ALLOWED_ORIGINS is not set. No browser origins will be allowed to call this API in production."
  );
}

const app = express();

// Render/Railway/most PaaS run behind a reverse proxy — needed for correct client IPs
// (used by the rate limiter) and for secure-cookie/HTTPS detection.
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (no Origin header, e.g. curl/health checks) and dev mode with no allowlist.
      if (!origin || (!isProd && allowedOrigins.length === 0)) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "100kb" }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

app.use("/api", generalLimiter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/me", meRouter);
app.use("/api/shifts", shiftsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof Error && err.message === "Not allowed by CORS") {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

await pruneExpiredShifts();
setInterval(() => {
  void pruneExpiredShifts().catch((e) => console.error("[prune] failed:", e));
}, 24 * 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT) || 4000;
const server = app.listen(PORT, () => {
  console.log(`Wage Tracker API listening on http://localhost:${PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
