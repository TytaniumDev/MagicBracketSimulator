# Scripts

Development and deployment utilities. Run from the repo root. Used by `npm run` (see root `package.json`), Docker/deploy docs, and agents.

**Dev / install (CLI):**
- `run-dev.js` — `npm run dev`: starts api + frontend concurrently (handles WSL/UNC path issues)
- `run-install.js` — `npm run install:all`: installs dependencies for root, api, frontend, worker

**GCP / Firebase (deployment & secrets):**
- `populate-worker-secret.js` — Stores worker config in GCP Secret Manager
- `populate-frontend-secret.js` — Stores frontend config in GCP Secret Manager
- `fetch-frontend-config.js` — Pulls frontend `config.json` from Secret Manager
- `get-cloud-run-url.js` — Prints deployed Cloud Run service URLs

**Auth (GCP mode):**
- `add-allowed-user.js` — Adds a Firebase Auth UID to the Firestore allowlist (see `ALLOWED_USERS.md`)
