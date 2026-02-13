# Secrets and credentials setup

Step-by-step instructions for where to create and store secrets used by Magic Bracket Simulator: Firebase/GCP, frontend build, and worker. **Goal: store no secrets on your local machine** — use Secret Manager and (for CI) GitHub Secrets.

**No .env required:** Scripts and the worker resolve the GCP project from `gcloud config get-value project` when `GOOGLE_CLOUD_PROJECT` is not set. So you can use only:

- `gcloud auth application-default login`
- `gcloud config set project YOUR_PROJECT_ID`

Then run `populate-worker-secret`, `get-cloud-run-url` if needed, and the worker with **no .env file**.

---

## Where secrets live (overview)

| Secret / credential | Where to set it | Used by |
|--------------------|-----------------|---------|
| Firebase / GCP project config | Firebase Console, GCP Console | Frontend (Firebase Hosting), API (Cloud Run) |
| GCP credentials (ADC or key) | `gcloud auth application-default login` or key file | worker, scripts (Secret Manager access) |
| Worker / API env (e.g. WORKER_SECRET) | API env (Cloud Run); worker: **Secret Manager** (or .env) | API, worker |
| **worker config** (API_URL, GCS_BUCKET, etc.) | **Google Secret Manager** (`npm run populate-worker-secret`) or worker .env | worker |
| **Frontend API URL** | **Committed** in `frontend/public/config.json` (stable App Hosting URL). **Not a secret** — visible when the app loads. Always used as-is; no override. | Frontend (Firebase Hosting) |

---

## 0. Finding your API URL

You need the API URL for **API_URL** (worker). For the frontend, it’s already set in committed `frontend/public/config.json` (stable App Hosting URL: `https://api--magic-bracket-simulator.us-central1.hosted.app` — not a secret, visible when the app loads).

### Option A – gcloud (no browser)

From repo root, with [gcloud](https://cloud.google.com/sdk/gcloud) installed and logged in:

```bash
# No .env needed if gcloud default project is set:
gcloud config set project magic-bracket-simulator
npm run get-cloud-run-url

# Or pass project explicitly:
npm run get-cloud-run-url -- --project=magic-bracket-simulator
# or: GOOGLE_CLOUD_PROJECT=magic-bracket-simulator npm run get-cloud-run-url
```

This lists Cloud Run services and their URLs. For **App Hosting**, use the stable backend URL from Firebase Console (e.g. `https://api--magic-bracket-simulator.us-central1.hosted.app`).

### Option B – Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com/) → your project.
2. Go to **Build** → **App Hosting**.
3. Open your backend; the **backend URL** (or “Service URL”) is shown there — that’s your Cloud Run URL.

### Option C – GCP Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select your project.
2. Go to **Cloud Run** (or: **Run** in the left menu).
3. Click your API service; the **URL** is at the top.

Use this URL when running `npm run populate-worker-secret`. The frontend always uses the committed `config.json` (same stable URL).

---

## 1. GCP / Firebase (project and service accounts)

**Where:** [Google Cloud Console](https://console.cloud.google.com/), [Firebase Console](https://console.firebase.google.com/).

### 1.1 GCP project and Firebase

- Ensure you have a GCP project (e.g. `magic-bracket-simulator`) linked to Firebase.
- Firebase Console: [Project settings](https://console.firebase.google.com/project/_/settings/general) – note project ID and (for frontend) the Firebase config (API key, auth domain, etc.).

### 1.2 Service account key for worker

**Where:** GCP Console → **IAM & Admin** → **Service accounts** → select (or create) a service account → **Keys**.

- Docs: [Creating and managing service account keys](https://cloud.google.com/iam/docs/create-key)

**Steps:**

1. In [GCP Console](https://console.cloud.google.com/iam-admin/serviceaccounts), select your project.
2. Create a service account (e.g. `magic-bracket-worker`) or select an existing one used for the worker.
3. Grant roles (e.g.):
   - **Pub/Sub Subscriber** (to pull job messages),
   - **Storage Object Admin** (or appropriate GCS role for the artifacts bucket),
   - **Cloud Datastore User** (or **Firestore** roles if using Firestore).
4. Open the service account → **Keys** → **Add key** → **Create new key** → **JSON**. Download the JSON file.
5. **On your Mac (or host running worker):**
   - Save the JSON somewhere safe (e.g. `~/.config/magicbracket/worker-key.json`).
   - Grant the service account **Secret Manager Secret Accessor** (so the worker can read `simulation-worker-config`). Optionally **Secret Manager Admin** if you will run the populate script with this key.
   - **No .env required:** Use `gcloud config set project YOUR_PROJECT_ID` and (if not using ADC) set `GOOGLE_APPLICATION_CREDENTIALS` in env or a minimal `.env`. The rest of the worker config comes from Secret Manager (see below).

### 1.3 Worker config via Secret Manager

#### Option A: Automated via GitHub Actions (recommended)

The **Provision Worker** workflow reads secrets from GitHub repo settings and syncs them into GCP Secret Manager. No interactive prompts, no gcloud on your dev machine.

1. Add the following secrets to your GitHub repo (**Settings > Secrets > Actions**):

   | Secret | Description |
   |---|---|
   | `GCP_SA_KEY` | GCP service account key JSON (from step 1.2) |
   | `WORKER_SECRET` | Shared secret between worker and API |
   | `API_URL` | Production API URL (see §0) |
   | `GCS_BUCKET` | Cloud Storage bucket name (e.g. `magic-bracket-simulator-artifacts`) |
   | `PUBSUB_SUBSCRIPTION` | Pub/Sub subscription for jobs (e.g. `job-created-worker`) |
   | `PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION` | Pub/Sub subscription for worker report-in (e.g. `worker-report-in-worker`) |
   | `GHCR_USER` | GitHub username (for Watchtower to pull worker images) |
   | `GHCR_TOKEN` | GitHub PAT with `read:packages` scope (for Watchtower) |

2. Run the **Provision Worker** workflow from the GitHub Actions tab or via:
   ```bash
   gh workflow run provision-worker.yml
   ```

This populates two secrets in GCP Secret Manager:
- `simulation-worker-config` — worker runtime config (API_URL, GCS_BUCKET, etc.)
- `worker-host-config` — host machine config (SA key, GHCR creds, IMAGE_NAME)

#### Option B: Manual (interactive script)

If you prefer not to use GitHub Actions, run the interactive script directly:

```bash
gcloud config set project magic-bracket-simulator
npm install
npm run populate-worker-secret
```

Use `--defaults` for non-interactive mode: `npm run populate-worker-secret -- --defaults --worker-secret=YOUR_SECRET`

#### IAM requirements

The identity the worker uses (ADC or service account key) must have **Secret Manager Secret Accessor** on the project. Same key can have Pub/Sub, GCS, Firestore roles as before. For the provision workflow, the SA key also needs **Secret Manager Admin** (to create/update secrets).

---

## 2. Firebase Hosting and frontend (no secrets on your machine)

The frontend reads **runtime config** from `/config.json` (API URL, optional log analyzer URL). **The API URL is not a secret** — it’s visible to anyone who loads the app (network requests). We **commit** `frontend/public/config.json` with the stable App Hosting URL (`https://api--magic-bracket-simulator.us-central1.hosted.app`). Deploy and local dev always use that file; there is no override.

### Build and deploy

```bash
npm run build --prefix frontend
# or: firebase deploy --only hosting   (predeploy runs the build)
```

### CI/CD – Deploy to Firebase Hosting on merge to main

A GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on **push to main** (after a PR is merged). It runs the same tests as CI (frontend lint/build, API lint/build/test); if all pass, it deploys the frontend to **Firebase Hosting**.

**Required GitHub secrets:**
- **FIREBASE_TOKEN** – Firebase CI token. Run `firebase login:ci` locally, then add as a secret.
- **VITE_FIREBASE_*** (all six) – Firebase web config for Google sign-in. Without these, the deployed app shows "Local User" instead of Google sign-in. Get them from [Firebase Console → Project Settings → Your apps](https://console.firebase.google.com/project/_/settings/general) (Web app config):
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN` (e.g. `magic-bracket-simulator.firebaseapp.com`)
  - `VITE_FIREBASE_PROJECT_ID` (e.g. `magic-bracket-simulator`)
  - `VITE_FIREBASE_STORAGE_BUCKET` (e.g. `magic-bracket-simulator.appspot.com`)
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`

### Local dev (no deploy)

Run `npm run frontend` (or `npm run dev`). The app uses **localhost** for the API when `/config.json` is absent or doesn’t override. No `.env` or config.json required for local dev.

### Firebase config (VITE_FIREBASE_*)

Firebase client config (API key, project ID, etc.) is still set at **build time** via `frontend/.env` or CI env. These are not highly sensitive (they’re in the client) but should not be committed. For production builds in CI, set them from GitHub Secrets or from Secret Manager (you can extend `frontend-config` or use a separate secret).

---

## 3. API (Cloud Run) env and worker secret

**Where:** Cloud Run service → **Edit & deploy new revision** → **Variables and secrets** (or equivalent in Cloud Build / Terraform).

- Docs: [Cloud Run: Setting environment variables](https://cloud.google.com/run/docs/configuring/services/environment-variables)

Set at least:

- `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `PUBSUB_TOPIC`, and any secrets (e.g. Gemini API key) already used.
- **WORKER_SECRET** (optional but recommended): a shared secret string. Set the same value in:
  - Cloud Run (API) env,
  - worker config (in Secret Manager via `npm run populate-worker-secret`, or in `.env` if not using Secret Manager).

### 3.1 Firebase App Hosting (API backend) and Moxfield

The API is deployed via **Firebase App Hosting** (`api/apphosting.yaml`). Secrets are referenced there (`secretEnv`: `GEMINI_API_KEY`, `WORKER_SECRET`, `MOXFIELD_USER_AGENT`). For the backend to read them at runtime you must **grant the App Hosting backend access** to each secret:

1. Create the secret (if not already in Secret Manager):
   ```bash
   firebase apphosting:secrets:set moxfield-user-agent
   ```
   When prompted, enter your Moxfield User-Agent string and confirm adding permissions.

2. If you created the secret in [Cloud Secret Manager](https://console.cloud.google.com/security/secret-manager) instead of the CLI, grant access so the backend can read it:
   ```bash
   firebase apphosting:secrets:grantaccess moxfield-user-agent --backend api
   ```
   Use your backend ID (e.g. from Firebase Console → Build → App Hosting → your backend). Without this step, `MOXFIELD_USER_AGENT` is not injected and `/api/moxfield-status` returns `enabled: false`; full Moxfield URL import will then fail until access is granted.

3. **Trigger a new rollout** after granting access. Secrets are injected when a new revision is built; the currently running revision will not see the secret until you redeploy. Either push a new commit to your App Hosting live branch (e.g. `main`) to trigger an automatic rollout, or in [Firebase Console](https://console.firebase.google.com/) go to **Build** → **App Hosting** → your backend → **Rollouts** and create a new rollout. Until a new rollout completes, the API will keep returning `enabled: false` for `/api/moxfield-status`.

---

## 4. Checklist summary (no secrets on your machine)

- [ ] **GCP project:** `gcloud config set project YOUR_PROJECT_ID` (or set `GOOGLE_CLOUD_PROJECT` in env). No .env required.
- [ ] **GitHub Secrets:** Add all worker/GHCR secrets (see §1.3 Option A) to GitHub repo settings.
- [ ] **Provision Worker:** Run the GitHub Actions workflow to sync secrets to GCP Secret Manager.
- [ ] **Worker machine:** Run `./scripts/setup-worker.sh` — reads from Secret Manager, no manual config.
- [ ] **Frontend config:** Committed `config.json` has the stable App Hosting URL (always used as-is).
- [ ] **API (Cloud Run):** WORKER_SECRET and other env set in Cloud Run; same WORKER_SECRET in worker config.
- [ ] **API (Firebase App Hosting):** If using Moxfield URL import, run `firebase apphosting:secrets:grantaccess moxfield-user-agent` (and `apphosting:secrets:set moxfield-user-agent` if the secret does not exist yet). See §3.1.

---

## 5. GitHub Actions secrets

**Required secrets** (repo **Settings → Secrets and variables → Actions**):

### Firebase Hosting deploy (push to main)

1. **FIREBASE_TOKEN** – Run `firebase login:ci` locally, paste the token into a secret named `FIREBASE_TOKEN`.
2. **VITE_FIREBASE_*** (all six) – Firebase web config. Without these, the deployed app uses mock "Local User" auth instead of Google sign-in. Copy from Firebase Console → Project Settings → Your apps → Web app:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

### Provision Worker (manual trigger)

See §1.3 Option A for the full list: `GCP_SA_KEY`, `WORKER_SECRET`, `API_URL`, `GCS_BUCKET`, `PUBSUB_SUBSCRIPTION`, `PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION`, `GHCR_USER`, `GHCR_TOKEN`.

---

## Helpful links

- [Finding your API URL](#0-finding-your-api-url) (above)
- [GCP Service account keys](https://cloud.google.com/iam/docs/create-key)
- [Cloud Run environment variables](https://cloud.google.com/run/docs/configuring/services/environment-variables)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)
- [Firebase App Hosting](https://console.firebase.google.com/project/_/apphosting)
- [Firebase project settings](https://console.firebase.google.com/project/_/settings/general)
- [Vite env and mode](https://vitejs.dev/guide/env-and-mode.html)
