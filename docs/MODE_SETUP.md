# Mode Setup Guide

This project supports two operational modes: **LOCAL** and **GCP**. This guide explains each mode and how to run the system.

## Mode Overview

| Feature | LOCAL Mode | GCP Mode |
|---------|------------|----------|
| Database | SQLite | Firestore |
| Worker presence | (none) | Realtime Database |
| File Storage | Local filesystem | Cloud Storage (GCS) |
| Job Queue | `GET /api/jobs/claim-sim` | `GET /api/jobs/claim-sim` |
| Analysis | Win rate / game stats | Win rate / game stats |
| Worker | (none) | worker_flutter/ (desktop) |

The desktop worker signs in with Firebase and watches the hosted Firestore
for work, so it only runs sims for GCP mode. LOCAL mode is for working on
the API and frontend: jobs can be created but stay queued.

## Mode Detection

The system automatically detects the mode based on the `GOOGLE_CLOUD_PROJECT` environment variable:
- **Set**: GCP mode (Firestore, Realtime Database, GCS)
- **Not set**: LOCAL mode (SQLite, filesystem)

At startup, you'll see log messages like:
```
[Job Store] Running in GCP mode
[Job Store] Project: magic-bracket-simulator
[Job Store] Using: Firestore + Cloud Storage
```

## Quick Mode Toggle

The easiest way to run locally is `dev:local` — it switches to local mode, starts the dev servers, and **automatically restores GCP mode when you Ctrl+C**:

```bash
npm run dev:local
```

You can also toggle manually:

```bash
npm run mode:local    # switch to LOCAL mode
npm run mode:hosted   # switch back to HOSTED/GCP mode
```

These commands copy or remove `.env.local` override files in `api/` and `frontend/`. The `.env.local` files take precedence over `.env` (built-in behavior for both Next.js and Vite), so your `.env` files stay unchanged.

---

## GCP Mode Setup

### Prerequisites
1. GCP Project with:
   - Firestore database
   - Realtime Database (worker presence)
   - Cloud Storage bucket
2. Service account key with permissions for Firestore, Realtime Database and GCS

### Configuration Files

#### api/.env
```bash
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
GCS_BUCKET="magic-bracket-simulator-artifacts"
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
WORKER_SECRET="shared-secret-for-internal-calls"
NODE_ENV="development"
```

### Running GCP Mode

```bash
npm run dev
```

Sims run on the desktop worker (`worker_flutter/`) in Cloud mode. It talks
to the hosted API (`https://api--magic-bracket-simulator.us-central1.hosted.app`).

### Services in GCP Mode

| Service | Purpose | Where it runs |
|---------|---------|---------------|
| api | API backend (Firestore, RTDB, GCS) | Local or Firebase App Hosting |
| frontend | React UI | Local or Firebase Hosting |
| worker | Desktop worker: claims sims and runs Forge as a local Java process | User machines (macOS, Windows) |

### Deployed API (Firebase App Hosting / Cloud Run)

When the API is deployed via Firebase App Hosting, it runs on Cloud Run. The **Cloud Run service account** (the identity that executes the API) must have **Cloud Datastore User** (`roles/datastore.user`) on the project so it can read/write Firestore (decks, jobs). If this role is missing, creating or listing jobs will fail with `7 PERMISSION_DENIED: User not authorized to perform this action`. See **Troubleshooting → Firestore permission errors** below for how to grant it.

---

## LOCAL Mode Setup

### Prerequisites
1. Node.js 20+
2. No GCP configuration needed

### Configuration
Simply ensure `GOOGLE_CLOUD_PROJECT` is **not set** in `api/.env`, or delete the `.env` file.

### Running LOCAL Mode
```bash
npm run dev:local    # starts local mode, restores GCP mode on exit
```

### Services in LOCAL Mode

| Service | Purpose |
|---------|---------|
| api | API backend with SQLite; saved decks in `api/data/decks/` (`SAVED_DECKS_DIR`) |
| frontend | React UI |

---

## Seeding Precons

Before using GCP mode, seed the precon decks to Firestore:

```bash
cd api
export $(grep -v '^#' .env | xargs)
npx tsx scripts/seed-decks.ts
```

This syncs the precons from Archidekt into Firestore.

---

## Troubleshooting

### "Running in LOCAL mode" when expecting GCP
- Check that `GOOGLE_CLOUD_PROJECT` is set in `api/.env`
- Ensure the .env file is being loaded (Next.js loads it automatically)

### Firestore permission errors (e.g. `7 PERMISSION_DENIED: User not authorized to perform this action`)
- **Deployed API (Firebase App Hosting / Cloud Run):** The backend runs as a Cloud Run service account. That identity must have **Cloud Datastore User** so it can read/write Firestore (decks, jobs). Grant the role on the project:
  - GCP Console → **IAM & Admin** → **IAM** → find the service account used by your App Hosting backend (e.g. `PROJECT_NUMBER-compute@developer.gserviceaccount.com` or the one shown in **Firebase** → **App Hosting** → your backend → **Settings**).
  - Click **Edit** (pencil) for that member → **Add another role** → **Cloud Datastore User** → Save.
  - Or via gcloud (replace `PROJECT_ID` and `SERVICE_ACCOUNT_EMAIL`):
    ```bash
    gcloud projects add-iam-policy-binding PROJECT_ID \
      --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
      --role="roles/datastore.user"
    ```
- **Local API:** Ensure service account key path is correct and the key’s account has Firestore read/write (e.g. Cloud Datastore User).

### Jobs stuck in QUEUED
- Ensure a desktop worker is running and signed in with an allowed account (the frontend's worker banner shows online workers)
- Check the desktop worker's log and Sentry (`magic-bracket-worker`) for errors
