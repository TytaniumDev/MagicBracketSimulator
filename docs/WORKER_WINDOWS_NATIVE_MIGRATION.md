# Migrating a Windows worker from WSL to native Windows

## Audience

A Claude agent running on the **Windows machine that hosts the local worker**
(the same machine whose Docker Desktop currently runs the worker container).
You have shell access; you can read/write files on `C:\` and inside WSL via
`\\wsl.localhost\Ubuntu\...` or `wsl.exe -d Ubuntu -- ...`.

## Why we are doing this

The worker is installed inside the Ubuntu WSL distro at
`/home/wsl/magic-bracket-worker/`. The container's bind mounts (sa.json, the
jobs dir, `/var/run/docker.sock`) all reference Ubuntu paths, which means the
container only starts when **Docker Desktop's "WSL Integration" for Ubuntu is
enabled**. That toggle has been silently flipped OFF twice now (most likely by
Docker Desktop auto-updates), and each time the worker stopped picking up jobs
until someone noticed and restarted things by hand.

Investigation summary from the last failure:

- `%APPDATA%\Docker\settings-store.json` had
  `EnableIntegrationWithDefaultWslDistro: false` and an empty
  `IntegratedWslDistros` array.
- Docker Desktop backend log confirmed:
  `wslintegration.serviceSettings{EnableIntegrationWithDefaultWslDistro:false, IntegratedWslDistros:[]string{}}`.
- Inside Ubuntu, `/var/run/docker.sock` did not exist and the
  `docker-desktop-user-distro` proxy was not running, so Docker resolved every
  Ubuntu bind mount to an empty placeholder directory under
  `/mnt/wsl/docker-desktop-bind-mounts/Ubuntu/<hash>/`. Container start failed
  with `not a directory` or `no such file or directory`.

This migration removes the dependency on WSL integration entirely. The worker
will live at a Windows path, the compose file will be invoked from PowerShell,
and Docker Desktop's WSL2 backend will handle the rest. The toggle can be on
or off — the worker will not care.

## Goal / Definition of done

1. The worker container is running, with `restart: unless-stopped`, started
   from a Windows-native directory (e.g. `C:\Users\<user>\magic-bracket-worker`).
2. The container survives a full Windows reboot **and** a Docker Desktop
   update without any manual intervention, regardless of whether WSL
   integration for Ubuntu is enabled.
3. The worker picks up a fresh simulation job from the API after the reboot
   test, end-to-end.
4. The old WSL-based worker (`~/magic-bracket-worker/` inside Ubuntu) is
   stopped and its container removed, but its files are preserved on disk
   until step 3 passes (rollback safety).

## Before you start

- **Read this entire document first.** Do not start running commands until
  you understand the rollback path in the "If things go wrong" section.
- **Confirm with the user before doing anything destructive** — stopping
  the current worker, deleting containers, removing files. The user is the
  authority on timing (e.g. they may have a job mid-run).
- **Do not commit secrets.** The `.env` file in the worker directory contains
  a `WORKER_SECRET`, a GHCR PAT (`GHCR_TOKEN` / `GITHUB_TOKEN`), and possibly
  other credentials. These must not leak into the repo, into logs you share,
  or into PR descriptions.

## Pre-migration state (what you will find)

Inside Ubuntu (`wsl.exe -d Ubuntu -- bash` to inspect):

```
/home/wsl/magic-bracket-worker/
├── .env                # WORKER_SECRET, GHCR token, WORKER_OWNER_EMAIL, etc.
├── docker-compose.yml  # Pulled from the repo's worker/docker-compose.yml
├── sa.json             # GCP service account key (~2.3 KB)
└── jobs/               # JOBS_DIR — deck/log scratch space
```

The `.env` will contain at least:

```
GOOGLE_CLOUD_PROJECT=magic-bracket-simulator
WORKER_OWNER_EMAIL=<user's email>
DOCKER_SOCK_GID=1001        # Linux value; will need to change
GHCR_TOKEN=ghp_...          # do NOT log or commit
WORKER_SECRET=...           # do NOT log or commit
# possibly JOBS_DIR, SIMULATION_IMAGE, etc.
```

Running container (Docker Desktop, viewable from PowerShell `docker ps -a`):

- Name: `magic-bracket-worker`
- Image: `ghcr.io/tytaniumdev/magicbracketsimulator/worker:latest` (or similar)
- Status: likely `Exited` right now (that is what triggered this migration)

## Migration plan (high level)

1. Verify Docker Desktop is healthy from PowerShell (`docker version` works
   from a non-WSL shell).
2. Create the target directory on Windows.
3. Copy `sa.json`, `.env`, and the latest `docker-compose.yml` from Ubuntu to
   Windows. Translate Ubuntu paths in `.env` to their Windows equivalents.
4. Make sure Docker Desktop's file-sharing settings allow the chosen
   directory (`C:\Users\...` is allowed by default on Docker Desktop for
   Windows — confirm in Settings → Resources → File sharing).
5. Stop the old WSL-based worker (`docker compose down` from inside Ubuntu,
   or `docker rm -f magic-bracket-worker` from PowerShell).
6. Start the new worker from PowerShell with `docker compose up -d`.
7. Verify: container is `Up`, logs show heartbeat success, end-to-end job
   pickup works.
8. Reboot test: restart Windows, confirm the worker auto-starts and picks up
   a new job.
9. Cleanup: once verified stable, delete `/home/wsl/magic-bracket-worker/`
   inside Ubuntu (ask user first).

## Step-by-step

### Step 1 — Sanity-check Docker Desktop from PowerShell

Open PowerShell (NOT Git Bash, NOT WSL). Run:

```powershell
docker version
docker ps -a --filter name=magic-bracket-worker
```

`docker version` must show both Client and Server. If only the Client shows,
Docker Desktop is not running — start it via `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`
and wait for it to be ready.

Confirm `docker context ls` shows `desktop-linux` (or similar) as current. Do
**not** switch contexts.

### Step 2 — Pick the target directory and create it

Recommended: `C:\Users\<user>\magic-bracket-worker\`.

Pick a path under `C:\Users\` because Docker Desktop's default
file-sharing rules already include it. Avoid `C:\ProgramData\`,
`C:\Windows\`, OneDrive-synced folders, and any path with spaces.

```powershell
$Target = "$env:USERPROFILE\magic-bracket-worker"
New-Item -ItemType Directory -Path $Target -Force | Out-Null
New-Item -ItemType Directory -Path "$Target\jobs" -Force | Out-Null
```

### Step 3 — Copy files from Ubuntu to Windows

From PowerShell (Windows can read the WSL filesystem via `\\wsl.localhost\`):

```powershell
$Src = "\\wsl.localhost\Ubuntu\home\wsl\magic-bracket-worker"
Copy-Item "$Src\sa.json"            "$Target\sa.json"
Copy-Item "$Src\.env"               "$Target\.env"
Copy-Item "$Src\docker-compose.yml" "$Target\docker-compose.yml"
```

If `.env` references additional files (e.g. a custom CA cert), copy those
too. Re-read the `.env` file after copying to confirm.

### Step 4 — Translate `.env` to Windows-native values

Open `$Target\.env` and make these edits. Leave everything else alone.

| Variable | Old value (WSL) | New value (Windows-native) |
|----------|-----------------|----------------------------|
| `DOCKER_SOCK_GID` | `1001` (or any Linux GID) | `0` |
| `SA_KEY_PATH`     | unset or `/home/wsl/.../sa.json` | `C:/Users/<user>/magic-bracket-worker/sa.json` |
| `JOBS_DIR`        | `/tmp/mbs-jobs` or `/home/wsl/.../jobs` | `C:/Users/<user>/magic-bracket-worker/jobs` |
| `GOOGLE_APPLICATION_CREDENTIALS` | unset | leave unset (the compose hardcodes `/secrets/sa.json` inside the container) |

Notes:

- Use **forward slashes** in `.env` paths. Docker Compose on Windows accepts
  forward-slash Windows paths in bind-mount sources and they are unambiguous.
- `DOCKER_SOCK_GID=0` is correct because on Docker Desktop for Windows the
  in-container `docker.sock` is owned by root (gid 0). The Linux value 1001
  came from the user's WSL Ubuntu user account and is meaningless here.
- Do **not** set `WORKER_ID` if it was previously unset — leaving it blank
  lets the worker derive a default. If it was set, keep the same value so
  metrics/ownership continuity is preserved.

### Step 5 — Sanity-check the compose file

`docker-compose.yml` does not need editing — the bind paths it declares come
from env vars you just translated. But double-check these lines render
correctly after substitution:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - ${JOBS_DIR:-/tmp/mbs-jobs}:${JOBS_DIR:-/tmp/mbs-jobs}
  - ${SA_KEY_PATH:-...}:/secrets/sa.json:ro
```

Run `docker compose config` from `$Target` to verify the merged config has
real Windows paths (no `<HOME>` literals, no `~`):

```powershell
cd $Target
docker compose config | Select-String "source:|sa.json|jobs"
```

If you see something like `source: C:\Users\<user>\magic-bracket-worker\sa.json`
and `target: /secrets/sa.json` — good.

### Step 6 — Stop the old WSL worker

**Ask the user first.** Confirm no simulation job is mid-run. Then from
PowerShell (one of these will work; try in order):

```powershell
# Preferred: clean compose-down from the old location
wsl.exe -d Ubuntu -- bash -c "cd /home/wsl/magic-bracket-worker && docker compose down"

# Fallback if compose-down can't reach the engine (e.g. integration is off):
docker rm -f magic-bracket-worker
```

Confirm with `docker ps -a --filter name=magic-bracket-worker` — no container
should remain.

### Step 7 — Start the new worker

```powershell
cd $Target
docker compose pull       # ensure we have the latest worker image
docker compose up -d
docker compose ps
docker compose logs --tail=100
```

Expected in logs:

- A startup banner with the worker ID.
- A successful API auth handshake (no 401/403).
- A heartbeat log roughly every 10–30 seconds.
- No `permission denied` on `/var/run/docker.sock`.
- No `no such file or directory` on `/secrets/sa.json` or the jobs dir.

If you see `permission denied` on the socket, `DOCKER_SOCK_GID` is wrong for
this machine. Try `DOCKER_SOCK_GID=0` first; if still failing, run
`docker run --rm -v /var/run/docker.sock:/var/run/docker.sock alpine ls -l /var/run/docker.sock`
to find the actual gid and set it to that.

### Step 8 — End-to-end verification

Coordinate with the user. They will trigger a simulation job from the
frontend (LOCAL mode if the API is running locally, or a real GCP job if the
worker is registered with hosted API). The worker logs should show:

1. Job pickup (Pub/Sub message or HTTP poll hit, depending on mode).
2. Simulation container spawn (`docker run --rm ghcr.io/.../simulation@sha256:...`).
3. Result POST back to the API with status `COMPLETED`.

If this works, the migration is functionally complete.

### Step 9 — Reboot test (the actual point of all this)

This is the test the user actually cares about, because the original
problem is "doesn't pick up new jobs after I restart my computer."

1. Tell the user you are about to reboot. Get explicit go-ahead.
2. `Restart-Computer` (or have the user do it).
3. After login, wait ~2 minutes for Docker Desktop to come up.
4. `docker ps` — `magic-bracket-worker` should be `Up`.
5. Have the user submit another job. Confirm pickup in logs.

If the worker is `Exited` after reboot:

- Check `docker logs magic-bracket-worker` for the failure reason.
- Check Docker Desktop is set to auto-start (`%APPDATA%\Docker\settings-store.json` → `AutoStart: true`).
- The compose has `restart: unless-stopped`, so the worker will retry until
  Docker Desktop is fully ready. Wait a couple minutes before declaring it
  broken.

### Step 10 — Cleanup (only after step 9 passes)

Ask the user before doing this. Once they confirm the new setup is stable:

```powershell
# Remove the old WSL files. Keep the .env / sa.json copies on Windows.
wsl.exe -d Ubuntu -- rm -rf /home/wsl/magic-bracket-worker
```

Do **not** uninstall anything in WSL (docker CLI, the Ubuntu distro itself).
The user may still want WSL for other work.

## If things go wrong (rollback)

The old worker files are still in `/home/wsl/magic-bracket-worker/` until
step 10. To roll back at any point before that:

```powershell
# Stop the new (Windows-native) worker
cd $env:USERPROFILE\magic-bracket-worker
docker compose down

# Re-enable WSL integration for Ubuntu via Docker Desktop UI:
#   Settings → Resources → WSL Integration → toggle Ubuntu ON → Apply & Restart

# Bring the old worker back up
wsl.exe -d Ubuntu -- bash -c "cd /home/wsl/magic-bracket-worker && docker compose up -d"
```

That returns the system to the pre-migration state. The `.env` you copied to
Windows is harmless to leave behind, but if the user prefers a clean
rollback, also delete `$env:USERPROFILE\magic-bracket-worker\`.

## Out of scope (do not do these here)

- Modifying `scripts/setup-worker.sh` to support Git Bash / PowerShell.
  That is a separate, larger change that needs design discussion. This doc
  is a one-time manual migration of an already-set-up machine.
- Pushing any code changes. The only change this doc produces in the repo
  is the doc itself (and the commit recording the work).
- Switching to native Docker Engine inside Ubuntu (apt install docker.io).
  That is another viable architecture but is not what this migration does.
- Rotating the `WORKER_SECRET` or GHCR token. Reuse the existing values.

## What success looks like, summarized

After this is done, the user can:

1. Auto-update Docker Desktop without breaking the worker.
2. Toggle WSL integration on or off without breaking the worker.
3. Reboot Windows and have the worker start picking up jobs again within
   ~2 minutes, with no manual intervention.

If any of those three things still requires hand-holding, the migration is
not done — investigate before declaring victory.
