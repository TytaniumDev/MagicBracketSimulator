# Scripts

Development and deployment utilities. Run from the repo root.

- `run-dev.js` — Starts orchestrator + frontend concurrently (handles WSL path issues)
- `run-install.js` — Installs dependencies for all subprojects
- `populate-worker-secret.js` — Interactive: stores worker config in GCP Secret Manager
- `populate-frontend-secret.js` — Stores frontend config in GCP Secret Manager
- `fetch-frontend-config.js` — Pulls frontend config.json from Secret Manager
- `get-cloud-run-url.js` — Prints deployed Cloud Run service URLs
- `add-allowed-user.js` — Adds a Firebase Auth UID to the Firestore allowlist
