# Magic Bracket Worker (Flutter Desktop)

Native macOS worker for the Magic Bracket Simulator. Runs as a system-tray
appliance, listens to Firestore for new simulations, spawns headless Forge
games as child Java processes, and writes a short-lived lease so the
backend can detect crashes within ~27 seconds.

This is the Flutter desktop counterpart to the existing Docker worker
(`../worker/`). Both can run simultaneously and share the same Firestore
collections — see `../docs/superpowers/specs/2026-05-11-flutter-worker-architecture-design.md`.

## Status

MVP scaffold (May 2026). Compiles and launches on macOS. The worker engine
is implemented end-to-end (Firestore listener → atomic claim transaction →
Java sim spawn → result write-back → lease heartbeat). System tray and
dashboard window are wired up. **Not yet runnable end-to-end** because the
Firebase project credentials need to be populated by the user (see Setup).

## Setup

### 1. Install Java 17 and Forge

```bash
# Java 17 (no sudo needed)
brew install openjdk@17
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc

# Forge data dir on macOS lives at:
mkdir -p "$HOME/Library/Application Support/Forge/decks/commander"

# Forge install — extract somewhere the app will look. By default the app
# checks $HOME/Library/Application Support/com.tytaniumdev.workerFlutter/forge
mkdir -p "$HOME/Library/Application Support/com.tytaniumdev.workerFlutter/forge"
curl -fsSL -o /tmp/forge.tar.bz2 \
  https://github.com/Card-Forge/forge/releases/download/forge-2.0.10/forge-installer-2.0.10.tar.bz2
tar -xjf /tmp/forge.tar.bz2 \
  -C "$HOME/Library/Application Support/com.tytaniumdev.workerFlutter/forge"
```

### 2. Configure Firebase

The app uses the same Firebase project as the rest of the simulator:

```bash
dart pub global activate flutterfire_cli
flutterfire configure --project=<your-firebase-project-id>
```

This regenerates `lib/firebase_options.dart` with real values. Without this
step the app launches into a "Setup Required" screen instead of starting
the engine — the Firebase native plugin throws an uncaught NSException on
placeholder credentials, so we detect them in Dart and short-circuit.

### 3. Run

```bash
flutter run -d macos
```

Once Firebase is configured, the app:
- Has no Dock icon (LSUIElement = true)
- Shows a menu-bar tray icon — left-click to open the dashboard, right-click for menu
- Starts the engine immediately on launch

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

## Known limitations / TODOs

- **Firebase Auth flow**: the app currently relies on the default Firebase
  client init. For production use you'd want `firebase_auth` desktop OAuth
  so each user's worker is scoped to their Firebase user (matches
  `ownerEmail` in worker docs).
- **Tray icon asset**: `assets/tray_icon.png` is referenced commented-out
  in `pubspec.yaml`. The app launches without it (the asset is loaded in
  a try/catch); add a 16×16 PNG and uncomment to get a custom icon
  instead of the system default.
- **No code signing / notarization**: the `.app` bundle is unsigned. For
  distribution to other Macs you'll need an Apple Developer account.
- **Forge data updates**: Forge ships a `.tar.bz2` installer; this MVP
  requires the user to manually unpack it. Plan 3 (cross-platform polish)
  should bundle Forge inside the `.app` and ship updates inline.
- **Logs**: sim stdout is captured into `SimResult.logText` and currently
  only used for winner parsing. Hooking it into the existing
  `POST /api/jobs/:id/logs/simulation` endpoint is a small follow-up so
  dashboards can show full game logs.

## Verification done

- `flutter analyze` — clean (no issues)
- `flutter test` — 18/18 pass
- `flutter build macos --debug` — builds to `build/macos/Build/Products/Debug/worker_flutter.app`
- `open build/macos/Build/Products/Debug/worker_flutter.app` — launches and stays running (verified via `ps`)
- Forge headless verified separately on macOS without xvfb: one Commander game completes in ~17s and prints a parseable winner line.
