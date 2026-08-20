import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { dayExpensesRouter } from "./routes/dayExpenses.js";
import { meRouter } from "./routes/me.js";
import { shiftsRouter } from "./routes/shifts.js";
import { spendingRouter } from "./routes/spending.js";
import { weekExtrasRouter } from "./routes/weekExtras.js";

/**
 * Builds the Express app — every middleware, route, and error handler —
 * deliberately without calling `.listen()`. Split out from index.ts so
 * tests (see backend/test/) can exercise the real HTTP stack through
 * supertest without binding a real port, and so simply importing this
 * module never has the side effect of starting a server. index.ts (the
 * actual process entrypoint) is the only place that calls `app.listen()`.
 */
export function createApp(): express.Express {
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
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("[warn] ADMIN_PASSWORD is not set. The admin panel (/admin) will be inaccessible until it is.");
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
      // Lets the frontend read the replacement session token PATCH /api/me/password
      // returns in a response header (see routes/me.ts) — browsers hide all
      // non-simple response headers from cross-origin fetch() by default.
      exposedHeaders: ["X-New-Token"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Client-Time-Zone"],
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

  // Friendly landing response for anyone hitting the bare API URL directly
  // (e.g. clicking the link to check whether Render has spun the service back
  // up). Doesn't require the /api prefix, unlike the actual routes below.
  app.get("/", (_req, res) => res.json({ status: "API is healthy and awake" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  // authLimiter is scoped to only signup/login — not the whole /api/auth
  // router — so it never catches POST /api/auth/logout. Logout is already
  // gated by requireAuth (needs a currently-valid JWT) and the general /api
  // limiter above; stacking the tight 20-req/15min signup/login limiter on
  // top of that let a burst of failed login attempts lock a legitimate,
  // already-authenticated user out of logging out, leaving their session
  // un-revoked server-side even though the frontend had already discarded
  // its local token (see sessions.test.ts for the exact scenario).
  app.use("/api/auth/signup", authLimiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api/shifts", shiftsRouter);
  app.use("/api/day-expenses", dayExpensesRouter);
  app.use("/api/week-extras", weekExtrasRouter);
  app.use("/api/spending", spendingRouter);
  app.use("/api/admin", adminRouter);

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

  return app;
}
