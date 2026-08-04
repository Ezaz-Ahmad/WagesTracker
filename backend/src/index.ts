import cors from "cors";
import "dotenv/config";
import express from "express";
import { pruneExpiredShifts } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { shiftsRouter } from "./routes/shifts.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/shifts", shiftsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

pruneExpiredShifts();
setInterval(pruneExpiredShifts, 24 * 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`Wage Tracker API listening on http://localhost:${PORT}`);
});
