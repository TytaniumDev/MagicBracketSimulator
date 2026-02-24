# AGENTS.md

## Philosophy
- **Intent SSOT:** This file is the Single Source of Truth for *intent*.
- **Execution SSOT:** The CI pipeline is the Source of Truth for *execution*.
- **Executable:** If it isn't an executable command or a hard constraint, it doesn't belong here.

## Tooling
- **Node.js**: 20+ (managed by `npm`)
- **Docker**: Required for simulation engine
- **Package Manager**: `npm` (Node)

## Setup
- **Install Node Dependencies**: `npm run install:all`
- **Start Dev Server**: `npm run dev`

## Testing & Verification
### Frontend
- **Lint**: `npm run lint --prefix frontend`
- **Build**: `npm run build --prefix frontend`

### API
- **Lint**: `npm run lint --prefix api`
- **Build**: `npm run build --prefix api`
- **Test**: `npm run test:unit --prefix api`

### Simulation Worker
- **Build**: `npm run build --prefix worker`

## Deployment
- **CI**: `.github/workflows/ci.yml` (Runs on PR)
- **Deploy**: `.github/workflows/deploy.yml` (Runs on push to main)

## Project Structure
- `frontend/`: React app
- `api/`: Next.js API, ingestion, and analysis
- `worker/`: Node.js + Docker simulation runner

## Cursor Cloud specific instructions

### LOCAL mode (no GCP/Docker required)
- Copy env overrides before starting: `cp api/.env.local.example api/.env.local && cp frontend/.env.local.example frontend/.env.local`
- Or use `npm run mode:local` (also tries to start the worker Docker container — safe to ignore Docker errors if you only need API + frontend).
- With `.env.local` in place, `npm run dev` starts API (`:3000`) + Frontend (`:5173`) via concurrently. No GCP credentials or Docker needed.
- In LOCAL mode the API uses SQLite + local filesystem; Firebase Auth is disabled (mock local user).

### Running services
- **API + Frontend together**: `npm run dev` (uses concurrently; requires `.env.local` files for LOCAL mode)
- **API only**: `npm run dev --prefix api` (port 3000)
- **Frontend only**: `npm run dev --prefix frontend` (port 5173)
- Worker and simulation containers require Docker and are optional for UI/API development.

### Gotchas
- The `POST /api/jobs` endpoint requires `deckIds` (array of 4 strings) and `simulations` (min 4, max 100).
- Precon deck IDs can be discovered via `GET /api/decks?type=precon`.
- The precon sync scheduler runs on API startup and fetches from Archidekt; this is normal and not an error.
