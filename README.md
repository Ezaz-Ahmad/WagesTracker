# Wage Tracker

A full-stack app for tracking work shifts, hourly earnings, and weekly goals — clock in/out, log shifts per day, see weekly/monthly/yearly earnings trends, and export a PDF report.

**Live:**
- App: https://wages-tracker-frontend.vercel.app
- API: https://wage-tracker-api.onrender.com (health check: `/api/health`)

> Note: the backend runs on Render's free plan with no persistent disk, so the SQLite database resets whenever the service restarts or spins down from inactivity (~15 min idle). Fine for a demo; see [Deploying](#deploying) for how to make it durable.

## Tech stack

**Backend** (`backend/`)
- [Express](https://expressjs.com/) 4 + TypeScript, running on Node ≥20 (`type: module`, ESM throughout)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — synchronous SQLite driver, WAL mode
- Auth: [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) (30-day JWTs) + [bcryptjs](https://github.com/dcodeIO/bcrypt.js) for password hashing
- [zod](https://zod.dev/) for request validation
- Hardening: [helmet](https://helmetjs.github.io/) (security headers), [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) (300 req/15min general, 20 req/15min on `/api/auth/*`), a CORS allowlist driven by `ALLOWED_ORIGINS`, and a startup check that refuses to boot in production without a real `JWT_SECRET`
- Dev tooling: [tsx](https://github.com/privatenumber/tsx) (watch mode), plain `tsc` for the production build
- Run with `node dist/index.js` after build; graceful shutdown on `SIGTERM`/`SIGINT`

**Frontend** (`frontend/`)
- React 18 + TypeScript, built with [Vite](https://vitejs.dev/) 8
- No router or state library — a single `AppContext` (React context + hooks) holds auth/session state and shift data; screens are switched by local state in `App.tsx`
- [jspdf](https://github.com/parallax/jsPDF) (+ `html2canvas`, pulled in transitively) to export weekly reports as PDF
- Plain CSS (`styles/tokens.css`, `styles/app.css`) — no CSS framework
- API calls go through a small `fetch` wrapper (`lib/api.ts`) that targets `VITE_API_URL` in production or the Vite dev proxy locally, and centralizes auth-error handling (expired/invalid token → auto logout)

**Data**: SQLite, one file, no separate database server. Schema/migrations live in `backend/src/db.ts`.

**Repo layout**: npm workspaces monorepo (`backend`, `frontend` as separate workspaces sharing one `package.json`/lockfile at the root).

`project/` and `chats/` are the original Claude Design handoff files (HTML/CSS prototypes + the design conversation transcript) — reference material only, not part of the running app.

## Local development

From the repo root:

```bash
npm install
cp backend/.env.example backend/.env
npm run dev
```

This starts the backend on `http://localhost:4000` and the frontend on `http://localhost:5173` together. Open the frontend URL — in dev, Vite proxies `/api` requests to the backend (see `frontend/vite.config.ts`), so no extra config is needed.

Useful scripts (run from the root):

- `npm run dev` — backend + frontend, both in watch mode
- `npm run build` — production build of both
- `npm run typecheck` — type-check both

## Configuration

### Backend (`backend/.env`, copy from `backend/.env.example`)

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | no | defaults to `4000` |
| `NODE_ENV` | recommended | set to `production` in production — enables the JWT secret check |
| `JWT_SECRET` | **yes, in production** | the app refuses to start in production with the default/dev secret. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DB_PATH` | no | path to the SQLite file, defaults to `./data/wage-tracker.sqlite`. In production, point this at a **persistent volume/disk** — most PaaS filesystems are ephemeral and you'll lose data on redeploy otherwise |
| `ALLOWED_ORIGINS` | **yes, in production** | comma-separated list of browser origins allowed to call the API, e.g. `https://your-app.vercel.app` |

### Frontend (`frontend/.env`, copy from `frontend/.env.example`)

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_API_URL` | **yes, in production** | the deployed backend's origin, e.g. `https://wage-tracker-api.onrender.com`. Leave unset locally — the Vite dev proxy handles it |

## Deploying

The backend and frontend are deployed separately: backend as a Node service (Render or Railway), frontend as a static site (Vercel or Netlify). The live deploy above uses **Render + Vercel**.

### Backend — Render

`render.yaml` at the repo root is a ready-to-use Render Blueprint: it builds the backend workspace, runs it with `npm run start -w backend`, and wires up a health check at `/api/health`. In the Render dashboard: New → Blueprint → point at this repo. After the first deploy, set `ALLOWED_ORIGINS` to your frontend's URL (the blueprint leaves it blank on purpose since you won't have that URL yet).

The build command is `npm install --include=dev && npm run build -w backend` — the `--include=dev` is required because Render sets `NODE_ENV=production` before installing, which npm otherwise treats as "skip devDependencies," and `typescript`/`@types/*` (needed to compile) live there.

**Free plan storage caveat:** Render's free plan doesn't support persistent disks. The SQLite file lives on the service's local filesystem, which is wiped on every restart/redeploy (Render also spins down and restarts free services after inactivity) — so accounts and shift data will periodically reset. This is fine for a demo/testing deploy. For real, durable data, upgrade the service to at least the Starter plan and add a `disk:` block (commented example is in `render.yaml`) mounted at `/var/data`, then point `DB_PATH` there.

### Backend — Railway

`railway.json` at the repo root configures the build/start commands. In the Railway dashboard, add a volume mounted at a path of your choice and set `DB_PATH` to a file inside it (e.g. `/data/wage-tracker.sqlite`), plus `JWT_SECRET`, `NODE_ENV=production`, and `ALLOWED_ORIGINS`.

### Frontend — Vercel

`frontend/vercel.json` sets the build command and output directory. In the Vercel project import, set **Root Directory** to `frontend` (this is a monorepo — if you don't set this, Vercel may try to detect the `backend` Express app as a second deployable "service," which you don't want; it doesn't work correctly as a Vercel serverless function). Add the env var `VITE_API_URL` pointing at your deployed backend.

### Frontend — Netlify

`frontend/netlify.toml` sets the build command, publish directory, and SPA redirect. In the Netlify site settings, set **Base directory** to `frontend`. Add the env var `VITE_API_URL` pointing at your deployed backend.

### Order of operations

1. Deploy the backend first (Render or Railway) with `ALLOWED_ORIGINS` left as a harmless placeholder (e.g. `http://localhost:5173`) since you won't have the frontend URL yet.
2. Deploy the frontend (Vercel or Netlify) with `VITE_API_URL` set to the backend's URL.
3. Go back to the backend and set `ALLOWED_ORIGINS` to the real frontend URL, then save (triggers an automatic redeploy).

## Production checklist

- [x] `JWT_SECRET` set to a strong, unique value (not the dev default) — auto-generated by the Render blueprint
- [x] `NODE_ENV=production` set on the backend
- [x] `ALLOWED_ORIGINS` set to the real frontend URL
- [ ] `DB_PATH` points at a persistent volume/disk — **not currently true**, since the live deploy is on Render's free plan (see storage caveat above)
- [x] `VITE_API_URL` set on the frontend build to the backend's URL
- [x] Backend `/api/health` returns `{"ok": true}`
- [x] Rate limiting is on by default (300 req/15min general, 20 req/15min on `/api/auth/*`) — adjust in `backend/src/index.ts` if it's too strict/loose for your traffic
