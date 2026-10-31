# Deployment and Setup Guide

## Prerequisites

*   **Node.js:** 20
*   **Flutter** (stable): only for working on the desktop worker (`worker_flutter/`).

See [api/README.md](../api/README.md) for detailed API setup (e.g., `.env` files).

### Windows Setup (WSL)

If opening the project from Windows (e.g., Cursor with a `\\wsl.localhost\...` path):
*   `npm run dev` will re-run inside WSL.
*   You need Node and npm installed **inside WSL** (not just Windows).
    ```bash
    sudo apt update && sudo apt install -y nodejs npm
    ```

## Deployment and Secrets

*   **GCP vs Local Mode:** See [MODE_SETUP.md](MODE_SETUP.md) for details.
*   **Secrets:** See [SECRETS_SETUP.md](SECRETS_SETUP.md) for step-by-step instructions.
    *   Frontend API URL is committed in `frontend/public/config.json`.

### Finding your API URL

The API runs on Firebase App Hosting at `https://api--magic-bracket-simulator.us-central1.hosted.app` (also shown in the [Firebase Console](https://console.firebase.google.com/) under App Hosting).

### Firebase Hosting (Frontend)

To deploy the frontend to Firebase Hosting:

```bash
firebase deploy --only hosting
```

**CI/CD:**
Merges to `main` trigger `deploy.yml`, which deploys the frontend to Firebase Hosting plus the Firestore and Realtime Database rules. It authenticates to GCP with workload identity (`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`) loaded from Doppler. The API rolls out through Firebase App Hosting.

---

## Desktop Worker

Simulations run on the desktop worker (`worker_flutter/`), a Flutter app for
macOS and Windows. Users download it from the `/worker-setup` page or the
[latest release](https://github.com/TytaniumDev/MagicBracketSimulator/releases/latest),
sign in with Google, and the worker claims sims from the hosted API.

- **Releases:** a merge to `main` that changes the app (`worker_flutter/`,
  except its tests, docs and `appcast.xml`), the Forge manifest or the
  release pipeline runs `release-worker.yml`, which builds, signs and
  publishes both platforms to a GitHub Release and updates
  `worker_flutter/appcast.xml`. API and frontend merges don't release the
  worker. Installed apps update themselves through Sparkle (macOS) and
  WinSparkle (Windows).
- **Forge:** the app installs the Forge release named in
  `worker_flutter/forge-manifest.json`, which it fetches from `main` at
  launch. `forge-update.yml` runs nightly and opens an auto-merging PR that
  bumps the manifest when Forge publishes a new release. The app reads the
  manifest only at launch, so that merge also cuts a worker release: the
  update restarts running workers, which then install the new Forge.
- **Worker settings** (name, concurrency) live in the app.
