# Wage Tracker

A small full-stack app for tracking work shifts, hourly earnings, and weekly goals.

- `backend/` — Express + TypeScript API, SQLite (via better-sqlite3), JWT auth
- `frontend/` — React + TypeScript + Vite SPA
- `project/`, `chats/` — original design handoff files from Claude Design (reference only; not part of the running app)

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

The backend and frontend are deployed separately: backend as a Node service (Railway or Render), frontend as a static site (Vercel or Netlify).

### Backend — Render

`render.yaml` at the repo root is a ready-to-use Render Blueprint: it builds the backend workspace, runs it with `npm run start -w backend`, and wires up a health check at `/api/health`. In the Render dashboard: New → Blueprint → point at this repo. After the first deploy, set `ALLOWED_ORIGINS` to your frontend's URL (the blueprint leaves it blank on purpose since you won't have that URL yet).

**Free plan storage caveat:** Render's free plan doesn't support persistent disks. The SQLite file lives on the service's local filesystem, which is wiped on every restart/redeploy (Render also spins down and restarts free services after inactivity) — so accounts and shift data will periodically reset. This is fine for a demo/testing deploy. For real, durable data, upgrade the service to at least the Starter plan and add a `disk:` block (commented example is in `render.yaml`) mounted at `/var/data`, then point `DB_PATH` there.

### Backend — Railway

`railway.json` at the repo root configures the build/start commands. In the Railway dashboard, add a volume mounted at a path of your choice and set `DB_PATH` to a file inside it (e.g. `/data/wage-tracker.sqlite`), plus `JWT_SECRET`, `NODE_ENV=production`, and `ALLOWED_ORIGINS`.

### Frontend — Vercel

`frontend/vercel.json` sets the build command and output directory. In the Vercel project settings, set **Root Directory** to `frontend` (this is a monorepo). Add the env var `VITE_API_URL` pointing at your deployed backend.

### Frontend — Netlify

`frontend/netlify.toml` sets the build command, publish directory, and SPA redirect. In the Netlify site settings, set **Base directory** to `frontend`. Add the env var `VITE_API_URL` pointing at your deployed backend.

### Order of operations

1. Deploy the backend first (Render or Railway) with `ALLOWED_ORIGINS` left blank.
2. Deploy the frontend (Vercel or Netlify) with `VITE_API_URL` set to the backend's URL.
3. Go back to the backend and set `ALLOWED_ORIGINS` to the frontend's URL, then redeploy the backend.

## Production checklist

- [ ] `JWT_SECRET` set to a strong, unique value (not the dev default)
- [ ] `NODE_ENV=production` set on the backend
- [ ] `ALLOWED_ORIGINS` set to your real frontend URL(s)
- [ ] `DB_PATH` points at a persistent volume/disk, not the ephemeral local filesystem (not the case on Render's free plan — see the Render section above)
- [ ] `VITE_API_URL` set on the frontend build to the backend's URL
- [ ] Backend `/api/health` returns `{"ok": true}` after deploy
- [ ] Rate limiting is on by default (300 req/15min general, 20 req/15min on `/api/auth/*`) — adjust in `backend/src/index.ts` if it's too strict/loose for your traffic
