# Magic Bracket Worker (Flutter Desktop)

Native macOS worker for the Magic Bracket Simulator. Runs as a system-tray
appliance, listens to Firestore for new simulations, spawns headless Forge
games as child Java processes, and writes a short-lived lease so the
backend can detect crashes within ~27 seconds.

This is the Flutter desktop counterpart to the existing Docker worker
(`../worker/`). Both can run simultaneously and share the same Firestore
collections — see `../docs/superpowers/specs/2026-05-11-flutter-worker-architecture-design.md`.

## Status

MVP working on macOS (May 2026). The app:
- Builds, launches, stays alive
- On first launch, automatically downloads + extracts the JRE and Forge
  into `~/Library/Application Support/com.tytaniumdev.magicBracketSimulator/`
  (~540 MB one-time, ~40 seconds on broadband)
- Runs the worker engine in the background (Firestore listener, atomic
  claim transaction, lease writer, Java sim spawner)
- Shows a dashboard window with status, capacity slider, active sim list

What's **deferred to Plan 3**:
- Firebase Auth (anonymous and Google) — the native firebase_auth plugin
  crashes on cold boot in our sandbox-disabled config; until we either
  sign the app properly or add Swift AppDelegate glue, Firestore writes
  will fail with permission-denied if your security rules require auth
- System tray (LSUIElement) — same root cause as auth; the tray_manager
  plugin crashes natively at init. App ships with a regular Dock icon
  for the MVP

## Setup

### 1. Configure Firebase (already done — see `lib/firebase_options.dart`)

If you ever need to regenerate it (e.g. switching Firebase projects):

```bash
dart pub global activate flutterfire_cli
flutterfire configure --project=<your-firebase-project-id>
```

### 2. Run

```bash
flutter build macos --debug
open build/macos/Build/Products/Debug/worker_flutter.app
```

On first launch the app shows a setup screen that downloads:
- Eclipse Temurin JRE 17 (~130 MB extracted, from Adoptium)
- Forge 2.0.10 (~410 MB extracted, from GitHub releases)

Once both are in place the engine boots automatically on every subsequent
launch — no further setup needed.

## Architecture

```
lib/
  main.dart                    Entry: Firebase + window + tray + engine
  firebase_options.dart        Stub until `flutterfire configure` runs
  config.dart                  Persistent worker identity + paths (workerId, capacity)
  models/
    sim.dart                   SimDoc, SimResult, JobInfo DTOs
  worker/
    sim_runner.dart            Spawns Java child process for one Forge sim;
                               also exports the pure parseGameLog() function
    sim_claim.dart             Firestore transactional claim + result reporter
    lease_writer.dart          5s heartbeat with lease.expiresAt = now+15s
    worker_engine.dart         Orchestrator: listener loop, capacity, cancel,
                               per-job cancel listeners, semaphore
  ui/
    dashboard.dart             Status card + capacity slider + active-sim list
    tray_setup.dart            Menu-bar icon + context menu

test/
  worker/
    sim_dto_test.dart          SimDoc.compositeId round-trip
    sim_runner_test.dart       parseGameLog (extracts winner + winning turn)
    sim_claim_test.dart        tryClaim + reportTerminal against fake Firestore
    lease_writer_test.dart     Lease heartbeat doc shape and lifecycle
```

`flutter test` runs all 18 tests (no Firebase project needed — uses `fake_cloud_firestore`).

## How it talks to the backend (Plan 1)

The Flutter worker depends on the lease-sweep infrastructure from PR #188:

- It writes `workers/{workerId}.lease.expiresAt = now + 15s` every 5 seconds.
- The backend's `POST /api/admin/sweep-leases` Cloud Task runs every ~12s and reverts any RUNNING sims whose owning worker's lease has expired.
- Worst-case crash detection: ~27s (15s lease + 12s sweep cadence).
- The sim claim is an atomic Firestore transaction with a `state == 'PENDING'` precondition, so it can race safely with Docker workers that claim through the API endpoint.

## Known limitations / Plan 3 follow-ups

- **Firebase Auth disabled at boot** (see Status). Firestore reads/writes
  will fail with permission-denied if your rules require an authenticated
  user. The plan 3 work either signs the app + uses Google Sign-In via
  desktop OAuth, or relaxes the rules for an anonymous worker identity.
- **No tray icon** (see Status). LSUIElement is set to false; tray_manager
  init crashes natively on cold boot in our sandbox-disabled config.
- **No code signing / notarization**: the `.app` bundle is unsigned. macOS
  Gatekeeper will warn first-time users. Distributing to other Macs
  requires an Apple Developer account.
- **Logs uploaded via API endpoint not yet wired**: sim stdout is captured
  into `SimResult.logText` and used for winner parsing. Hooking it into
  the existing `POST /api/jobs/:id/logs/simulation` endpoint is a small
  follow-up so frontend dashboards can show full game logs.
- **Diagnostic log file**: the app writes to
  `~/Library/Logs/com.tytaniumdev.magicBracketSimulator.log` on every launch.
  Useful for debugging boot issues; safe to delete.

## Verification done

- `flutter analyze` — clean (no issues)
- `flutter test` — 18/18 pass
- `flutter build macos --debug` — builds to `build/macos/Build/Products/Debug/worker_flutter.app`
- `open build/macos/Build/Products/Debug/worker_flutter.app` — launches and stays running (verified via `ps`, ~356 MB RAM idle)
- First-launch installer flow — downloads JRE (130 MB) + Forge (412 MB) in ~40s
- Bundled JRE + Forge run an end-to-end Commander sim: one game in ~22s, exit 0, parseable winner line
- Engine boot reaches "engine running" — Firestore listener + lease writer + claim loop all active
