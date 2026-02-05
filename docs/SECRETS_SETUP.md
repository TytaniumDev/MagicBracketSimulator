# Secrets and credentials setup

Step-by-step instructions for where to create and store secrets used by Magic Bracket Simulator: Firebase/GCP, frontend build, and local-worker. **Goal: store no secrets on your local machine** — use Secret Manager and (for CI) GitHub Secrets.

**No .env required:** Scripts and the local-worker resolve the GCP project from `gcloud config get-value project` when `GOOGLE_CLOUD_PROJECT` is not set. So you can use only:

- `gcloud auth application-default login`
- `gcloud config set project YOUR_PROJECT_ID`

Then run `populate-worker-secret`, `get-cloud-run-url` if needed, and the local-worker with **no .env file**.

---

## Where secrets live (overview)

| Secret / credential | Where to set it | Used by |
|--------------------|-----------------|---------|
| Firebase / GCP project config | Firebase Console, GCP Console | Frontend (Firebase Hosting), Orchestrator (Cloud Run) |
| GCP credentials (ADC or key) | `gcloud auth application-default login` or key file | local-worker, scripts (Secret Manager access) |
| Worker / API env (e.g. WORKER_SECRET) | Orchestrator env (Cloud Run); local-worker: **Secret Manager** (or .env) | Orchestrator, local-worker |
| **local-worker config** (API_URL, GCS_BUCKET, etc.) | **Google Secret Manager** (`npm run populate-worker-secret`) or local-worker .env | local-worker |
| **Frontend API URL** | **Committed** in `frontend/public/config.json` (stable App Hosting URL). **Not a secret** — visible when the app loads. Always used as-is; no override. | Frontend (Firebase Hosting) |

---

## 0. Finding your orchestrator URL

You need the orchestrator URL for **API_URL** (local-worker). For the frontend, it’s already set in committed `frontend/public/config.json` (stable App Hosting URL: `https://orchestrator--magic-bracket-simulator.us-central1.hosted.app` — not a secret, visible when the app loads).

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

This lists Cloud Run services and their URLs. For **App Hosting**, use the stable backend URL from Firebase Console (e.g. `https://orchestrator--magic-bracket-simulator.us-central1.hosted.app`).

### Option B – Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com/) → your project.
2. Go to **Build** → **App Hosting**.
3. Open your backend; the **backend URL** (or “Service URL”) is shown there — that’s your Cloud Run URL.

### Option C – GCP Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select your project.
2. Go to **Cloud Run** (or: **Run** in the left menu).
3. Click your orchestrator service; the **URL** is at the top.

Use this URL when running `npm run populate-worker-secret`. The frontend always uses the committed `config.json` (same stable URL).

---

## 1. GCP / Firebase (project and service accounts)

**Where:** [Google Cloud Console](https://console.cloud.google.com/), [Firebase Console](https://console.firebase.google.com/).

### 1.1 GCP project and Firebase

- Ensure you have a GCP project (e.g. `magic-bracket-simulator`) linked to Firebase.
- Firebase Console: [Project settings](https://console.firebase.google.com/project/_/settings/general) – note project ID and (for frontend) the Firebase config (API key, auth domain, etc.).

### 1.2 Service account key for local-worker

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
5. **On your Mac (or host running local-worker):**
   - Save the JSON somewhere safe (e.g. `~/.config/magicbracket/worker-key.json`).
   - Grant the service account **Secret Manager Secret Accessor** (so the worker can read `local-worker-config`). Optionally **Secret Manager Admin** if you will run the populate script with this key.
   - **No .env required:** Use `gcloud config set project YOUR_PROJECT_ID` and (if not using ADC) set `GOOGLE_APPLICATION_CREDENTIALS` in env or a minimal `.env`. The rest of the worker config comes from Secret Manager (see below).

### 1.3 local-worker config via Secret Manager (no .env copy on each machine)

**One-time setup:** Run the interactive script from the repo root. It prompts for each value and gives **clickable links** to where to get it in GCP Console, then creates/updates the secret `local-worker-config` in Secret Manager.

```bash
# From repo root. No .env needed if gcloud default project is set:
gcloud config set project magic-bracket-simulator
npm run populate-worker-secret
# or: node scripts/populate-worker-secret.js
# or: GOOGLE_CLOUD_PROJECT=magic-bracket-simulator npm run populate-worker-secret
```

- The script asks for: **API_URL**, **GCS_BUCKET**, **PUBSUB_SUBSCRIPTION**, **WORKER_SECRET**, **FORGE_SIM_IMAGE**, **MISC_RUNNER_IMAGE**, **JOBS_DIR**.
- For each, it prints a link (e.g. Cloud Run, Storage, Pub/Sub) so you can copy the value from the console.
- After you fill values, it creates or updates the secret. On any **new machine**, you only need the gcloud default project (`gcloud config set project ...`) and Application Default Credentials (or the service account key with Secret Manager access); **no .env needed** and no need to copy or re-enter all values.

**IAM:** The identity the worker uses (ADC or service account key) must have **Secret Manager Secret Accessor** on the secret (or project). Same key can have Pub/Sub, GCS, Firestore roles as before.

---

## 2. Firebase Hosting and frontend (no secrets on your machine)

The frontend reads **runtime config** from `/config.json` (API URL, optional log analyzer URL). **The API URL is not a secret** — it’s visible to anyone who loads the app (network requests). We **commit** `frontend/public/config.json` with the stable App Hosting URL (`https://orchestrator--magic-bracket-simulator.us-central1.hosted.app`). Deploy and local dev always use that file; there is no override.

### Build and deploy

```bash
npm run build --prefix frontend
# or: firebase deploy --only hosting   (predeploy runs the build)
```

### CI/CD – Deploy to Firebase Hosting on merge to main

A GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on **push to main** (after a PR is merged). It runs the same tests as CI (frontend lint/build, orchestrator lint/build/test); if all pass, it deploys the frontend to **Firebase Hosting**.

**Required GitHub secret:** **FIREBASE_TOKEN** – Firebase CI token. Locally run `firebase login:ci`, then in the repo **Settings → Secrets and variables → Actions** add a secret named `FIREBASE_TOKEN` with that value.

### Local dev (no deploy)

Run `npm run frontend` (or `npm run dev`). The app uses **localhost** for the API when `/config.json` is absent or doesn’t override. No `.env` or config.json required for local dev.

### Firebase config (VITE_FIREBASE_*)

Firebase client config (API key, project ID, etc.) is still set at **build time** via `frontend/.env` or CI env. These are not highly sensitive (they’re in the client) but should not be committed. For production builds in CI, set them from GitHub Secrets or from Secret Manager (you can extend `frontend-config` or use a separate secret).

---

## 3. Orchestrator (Cloud Run) env and worker secret

**Where:** Cloud Run service → **Edit & deploy new revision** → **Variables and secrets** (or equivalent in Cloud Build / Terraform).

- Docs: [Cloud Run: Setting environment variables](https://cloud.google.com/run/docs/configuring/services/environment-variables)

Set at least:

- `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `PUBSUB_TOPIC`, and any secrets (e.g. Gemini API key) already used.
- **WORKER_SECRET** (optional but recommended): a shared secret string. Set the same value in:
  - Cloud Run (orchestrator) env,
  - local-worker config (in Secret Manager via `npm run populate-worker-secret`, or in `.env` if not using Secret Manager).

---

## 4. Checklist summary (no secrets on your machine)

- [ ] **GCP project:** `gcloud config set project YOUR_PROJECT_ID` (or set `GOOGLE_CLOUD_PROJECT` in env). No .env required.
- [ ] **Cloud Run URL:** Use `npm run get-cloud-run-url` or Firebase/GCP Console (see §0).
- [ ] **GCP credentials:** Use `gcloud auth application-default login` (or a key) so scripts and local-worker can read Secret Manager. No key file required if using ADC.
- [ ] **local-worker config:** Run `npm run populate-worker-secret` once; on each machine set only gcloud default project and ADC. No .env needed.
- [ ] **Frontend config:** Committed `config.json` has the stable App Hosting URL (always used as-is).
- [ ] **Orchestrator (Cloud Run):** WORKER_SECRET and other env set in Cloud Run; same WORKER_SECRET in local-worker config (in Secret Manager via populate-worker-secret).

---

## 5. GitHub Actions – Firebase Hosting deploy (push to main)

**Required:** In the repo **Settings → Secrets and variables → Actions**, add **FIREBASE_TOKEN**. From your machine run `firebase login:ci`, then paste the token into a new secret named `FIREBASE_TOKEN`. The workflow uses the committed `frontend/public/config.json`; no other secrets are needed for the frontend.

---

## Helpful links

- [Finding your orchestrator URL](#0-finding-your-orchestrator-url) (above)
- [GCP Service account keys](https://cloud.google.com/iam/docs/create-key)
- [Cloud Run environment variables](https://cloud.google.com/run/docs/configuring/services/environment-variables)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)
- [Firebase App Hosting](https://console.firebase.google.com/project/_/apphosting)
- [Firebase project settings](https://console.firebase.google.com/project/_/settings/general)
- [Vite env and mode](https://vitejs.dev/guide/env-and-mode.html)
