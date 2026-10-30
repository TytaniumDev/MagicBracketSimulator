# Secrets and credentials setup

Step-by-step instructions for where to create and store secrets used by Magic Bracket Simulator: Firebase/GCP, the frontend build and the API. **Goal: store no secrets on your local machine** — use Doppler, Secret Manager and (for CI) GitHub Secrets.

The desktop worker needs no secrets: it signs in as its user, and its release
secrets (signing, Sentry) live in Doppler for `release-worker.yml`.

---

## Where secrets live (overview)

| Secret / credential | Where to set it | Used by |
|--------------------|-----------------|---------|
| Firebase / GCP project config | Firebase Console, GCP Console | Frontend (Firebase Hosting), API (Cloud Run) |
| GCP credentials (ADC or key) | `gcloud auth application-default login` or key file | scripts (Secret Manager access) |
| **API secrets** (WORKER_SECRET, RESEND_API_KEY, ADMIN_EMAIL(S), MOXFIELD_USER_AGENT, SENTRY_DSN) | **Doppler**, synced to GCP Secret Manager by the **Sync API Secrets** workflow (§3.1) | API (Firebase App Hosting) |
| **CI/CD Secrets** | **Doppler** (project: magic-bracket-simulator, config: dev) | GitHub Actions |
| **Frontend API URL** | **Committed** in `frontend/public/config.json` (stable App Hosting URL). **Not a secret** — visible when the app loads. Always used as-is; no override. | Frontend (Firebase Hosting) |

---

## 0. Finding your API URL

The API runs on Firebase App Hosting at the stable URL `https://api--magic-bracket-simulator.us-central1.hosted.app` (Firebase Console → **Build** → **App Hosting** → your backend). The frontend reads it from the committed `frontend/public/config.json`; it is not a secret.

---

## 1. GCP / Firebase (project and service accounts)

**Where:** [Google Cloud Console](https://console.cloud.google.com/), [Firebase Console](https://console.firebase.google.com/).

### 1.1 GCP project and Firebase

- Ensure you have a GCP project (e.g. `magic-bracket-simulator`) linked to Firebase.
- Firebase Console: [Project settings](https://console.firebase.google.com/project/_/settings/general) – note project ID and (for frontend) the Firebase config (API key, auth domain, etc.).

## 2. Firebase Hosting and frontend (no secrets on your machine)

The frontend reads **runtime config** from `/config.json` (API URL, optional log analyzer URL). **The API URL is not a secret** — it’s visible to anyone who loads the app (network requests). We **commit** `frontend/public/config.json` with the stable App Hosting URL (`https://api--magic-bracket-simulator.us-central1.hosted.app`). Deploy and local dev always use that file; there is no override.

### Build and deploy

```bash
npm run build --prefix frontend
# or: firebase deploy --only hosting   (predeploy runs the build)
```

### CI/CD – Deploy to Firebase Hosting on merge to main

A GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on **push to main** (after a PR is merged). It runs the same tests as CI (frontend lint/build, API lint/build/test); if all pass, it deploys the frontend to **Firebase Hosting**.

**Required Doppler secrets (fetched at runtime via `DOPPLER_TOKEN`):**
- **VITE_FIREBASE_*** (all six) – Firebase web config for Google sign-in. Without these, the deployed app shows "Local User" instead of Google sign-in. Get them from [Firebase Console → Project Settings → Your apps](https://console.firebase.google.com/project/_/settings/general) (Web app config):
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN` (e.g. `magic-bracket-simulator.firebaseapp.com`)
  - `VITE_FIREBASE_PROJECT_ID` (e.g. `magic-bracket-simulator`)
  - `VITE_FIREBASE_STORAGE_BUCKET` (e.g. `magic-bracket-simulator.appspot.com`)
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`
- **GCP_WORKLOAD_IDENTITY_PROVIDER** & **GCP_SERVICE_ACCOUNT** - Used for keyless Firebase deployment authentication.

### Local dev (no deploy)

Run `npm run frontend` (or `npm run dev`). The app uses **localhost** for the API when `/config.json` is absent or doesn’t override. No `.env` or config.json required for local dev.

### Firebase config (VITE_FIREBASE_*)

Firebase client config (API key, project ID, etc.) is still set at **build time** via `frontend/.env` or CI env. These are not highly sensitive (they’re in the client) but should not be committed. For production builds in CI, set them from Doppler.

---

## 3. API (Cloud Run) env and WORKER_SECRET

**Where:** Cloud Run service → **Edit & deploy new revision** → **Variables and secrets** (or equivalent in Cloud Build / Terraform).

- Docs: [Cloud Run: Setting environment variables](https://cloud.google.com/run/docs/configuring/services/environment-variables)

Set at least:

- `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, and any secrets already used.
- **WORKER_SECRET**: a shared secret string. Cloud Tasks recovery checks and the Cloud Scheduler jobs (stale sweep, precon sync) send it as `X-Worker-Secret`, and it signs access-request approval links. The scheduler jobs read it from the `worker-secret` secret (see `docs/STALE_SWEEPER.md`, `docs/PRECON_SYNC.md`).

### 3.1 Firebase App Hosting (API backend) secrets — managed in Doppler

The API is deployed via **Firebase App Hosting** (`api/apphosting.yaml`), which can only read secrets from GCP Secret Manager. **Doppler is the source of truth**; the **Sync API Secrets** workflow (`.github/workflows/sync-api-secrets.yml`, `scripts/sync-api-secrets.js`) copies them across. Never edit these secrets in GCP directly — the next sync overwrites them.

For every `- variable: NAME` / `secret: id` entry in `apphosting.yaml`, the workflow copies the Doppler key `NAME` into the GCP secret `id`:

| Doppler key | GCP secret |
|---|---|
| `WORKER_SECRET` | `worker-secret` |
| `MOXFIELD_USER_AGENT` | `moxfield-user-agent` |
| `RESEND_API_KEY` | `resend-api-key` |
| `ADMIN_EMAIL` | `admin-email` (receives access-request emails) |
| `ADMIN_EMAILS` | `admin-emails` (comma-separated admin accounts) |
| `SENTRY_DSN` | `sentry-dsn` (also used for `NEXT_PUBLIC_SENTRY_DSN`) |

To change an API secret:

1. Edit it in Doppler (same project/config the `DOPPLER_TOKEN` GitHub secret points at).
2. Run the sync: `gh workflow run sync-api-secrets.yml` (or **Actions → Sync API Secrets → Run workflow**). Keys missing from Doppler are skipped; unchanged values get no new version.
3. Roll out (see **Rolling out** below) so App Hosting picks up the new version.

**Adding a new API secret:** add the `variable`/`secret` entry to `apphosting.yaml`, add the key to Doppler, run the sync, then grant the backend access once (the sync creates the secret but doesn't grant App Hosting read access):
```bash
firebase apphosting:secrets:grantaccess <secret-id> --backend api
```
Without access, the variable is not injected (e.g. a missing `MOXFIELD_USER_AGENT` makes `/api/moxfield-status` return `enabled: false`).

**Rolling out:** secrets are injected when a new revision is built; the currently running revision will not see the secret until you redeploy. Either push a new commit to your App Hosting live branch (e.g. `main`) to trigger an automatic rollout, or in [Firebase Console](https://console.firebase.google.com/) go to **Build** → **App Hosting** → your backend → **Rollouts** and create a new rollout. Until a new rollout completes, the API keeps the old values.

---

## 4. Checklist summary (no secrets on your machine)

- [ ] **GCP project:** `gcloud config set project YOUR_PROJECT_ID` (or set `GOOGLE_CLOUD_PROJECT` in env). No .env required.
- [ ] **GitHub Secrets:** Ensure `DOPPLER_TOKEN` is set in GitHub repo settings.
- [ ] **Frontend config:** Committed `config.json` has the stable App Hosting URL (always used as-is).
- [ ] **API (Firebase App Hosting):** API secrets live in Doppler; run the Sync API Secrets workflow after changing them, then roll out. See §3.1.

---

## 5. GitHub Actions secrets

**Required GitHub secrets** (repo **Settings → Secrets and variables → Actions**):

The CI pipelines have been migrated to use **Doppler** for secrets management. Most environment variables (Firebase config, GCP keys, etc.) are fetched at runtime via the Doppler CLI.

1. **DOPPLER_TOKEN** – The single bootstrap token required for GitHub Actions to fetch the rest of the secrets.
2. *(Auto-provided)* `GITHUB_TOKEN` is used implicitly by some actions.
3. *(Optional)* `CLAUDE_CODE_OAUTH_TOKEN` if using AI code review actions.

See §2 and §3.1 for the full list of variables that are securely injected from Doppler during CI.

---

## Helpful links

- [Finding your API URL](#0-finding-your-api-url) (above)
- [GCP Service account keys](https://cloud.google.com/iam/docs/create-key)
- [Cloud Run environment variables](https://cloud.google.com/run/docs/configuring/services/environment-variables)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)
- [Firebase App Hosting](https://console.firebase.google.com/project/_/apphosting)
- [Firebase project settings](https://console.firebase.google.com/project/_/settings/general)
- [Vite env and mode](https://vitejs.dev/guide/env-and-mode.html)
