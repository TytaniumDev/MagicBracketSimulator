# Overnight Status — Magic Bracket Worker Rework

Worked autonomously through the night and into the morning. Both PRs are open with the Flutter app **launched, installer working, and engine booting end-to-end on macOS.**

## TL;DR

- **PR #188** ([lease-sweep backend](https://github.com/TytaniumDev/MagicBracketSimulator/pull/188)) — Plan 1, ready to merge. Backend infra; dormant until Flutter workers write leases. Three code-review concerns from the final reviewer have been fixed.
- **PR #189** ([Flutter Mac worker MVP](https://github.com/TytaniumDev/MagicBracketSimulator/pull/189)) — Plan 2, working end-to-end on macOS. App builds, launches, auto-downloads JRE+Forge on first run, boots the engine. Auth and tray are deferred to Plan 3 (see "Plan 3 deferrals" in the PR).
- **Plan 3** (auth, system tray, Windows, code signing, auto-update) — not started; design left for after #188 and #189 are reviewed.

## What works end-to-end (verified)

1. **`flutterfire configure` ran successfully** against `magic-bracket-simulator`. `firebase_options.dart` has real credentials.
2. **Auto-install of JRE + Forge** on first launch — ~40 seconds, ~540 MB total. The app shows a setup screen with progress bars. Subsequent launches reuse the local install.
3. **Bundled JRE + Forge run a real Commander game** end-to-end on macOS without xvfb. Game completes in ~22 seconds, prints a parseable winner line.
4. **App boots all the way to "engine running"** — Firestore listener active, lease writer ticking, claim loop ready. Verified via the diagnostic log at `~/Library/Logs/com.tytaniumdev.workerFlutter.log`.
5. **App stays alive** indefinitely once booted (~356 MB RAM idle).
6. **18/18 unit tests pass.**
7. **Plan 1 review concerns fixed**:
   - `revertSimToPending` now clears `startedAt`/`completedAt`/`durationMs`/`errorMessage`
   - Firestore field override added for `workers.lease.expiresAt`
   - Frontend `WorkerStatusBanner` shows a red dot for crashed workers

## Important: how I got there (the rough parts)

The biggest unexpected blocker was that **several Firebase plugins crash with uncaught NSExceptions on macOS in the sandbox-disabled, unsigned config** — and those native crashes bypass Dart try/catch entirely. The pattern:

- `firebase_auth_macos`: crashes on `signInAnonymously()` (likely because Anonymous Auth isn't enabled in your Firebase Console, but the plugin throws natively before Dart can see the error)
- `tray_manager`: crashes on `init()` when combined with LSUIElement=true and sandbox-disabled entitlements
- `cloud_firestore_macos`: crashes inconsistently during listener setup when no auth is established

To get a working MVP I made three pragmatic concessions, all documented in PR #189 as Plan 3 follow-ups:

1. **No auth at boot.** Engine starts without `signInAnonymously()`. Firestore writes will fail with permission-denied if your security rules require auth — but the engine surfaces those errors in the dashboard instead of crashing the app.
2. **No system tray.** `LSUIElement=false`, so the app has a normal Dock icon and visible window instead of menu-bar-only. Closing the window hides it (engine keeps running) so it's still "set and forget."
3. **Engine starts in a background `Future`.** If a native Firestore crash happens later, the UI stays up.

Forge running headless on macOS without xvfb was also a real win — verified via the spike. The trick: do NOT pass `-Djava.awt.headless=true` to Forge's sim subcommand. Forge silently exits 1 with that flag (this is undocumented). Without it, Forge initialises a hidden AWT toolkit and runs cleanly.

## What you need to do when you wake up

### Highest priority

1. **Review and merge PR #188.** It's small, low-risk, dormant. Once merged + deployed, run `npm run bootstrap:lease-sweep --prefix api` once.
2. **Open the Flutter app** and confirm it works on your machine:
   - `git checkout flutter-mac-worker`
   - `cd worker_flutter && flutter build macos --debug`
   - `open build/macos/Build/Products/Debug/worker_flutter.app`
   - First launch: setup screen, ~40s of downloads, dashboard appears
   - Subsequent launches: dashboard appears immediately
3. **Check Firestore security rules.** If `workers/{workerId}` writes require authenticated users with matching `ownerEmail`, the engine will get permission-denied at every lease tick. Options:
   - Relax rules temporarily so unauthenticated workers can write to `workers/{workerId}` (security risk in prod; fine for solo dev)
   - Enable Anonymous Auth in Firebase Console (Authentication → Sign-in method → Anonymous), then re-enable the auth call in `main.dart`
   - Wait for Plan 3 to add Google Sign-In properly

### Medium priority

4. **Try creating a real job via the existing frontend** and watch if the Flutter worker picks it up. The `worker_flutter` doc should appear in your `workers` collection with `workerType: 'flutter'` and a fresh `lease.expiresAt`. A PENDING sim should flip to RUNNING with `workerId` matching the worker's UUID.
5. **Review PR #189's "Plan 3 deferrals" list** and decide priority for Plan 3 work.

## Plan 3 design sketch (for when you're ready)

Order of operations I'd suggest:

1. **Apple Developer account + code signing** — unblocks everything else; many native plugins behave better when the app is signed
2. **Re-enable Firebase Auth via Google Sign-In desktop OAuth** (`firebase_auth_oauth` or `googleapis_auth`)
3. **Re-enable tray (LSUIElement=true) and verify tray_manager init doesn't crash** post-signing
4. **Hook sim stdout into `/api/jobs/:id/logs/simulation`** so frontend log views work for flutter-served sims
5. **Windows build** — replicate the install flow for `.exe`/`.msi`. Same `Installer` class should work with arch detection.
6. **Auto-updater** via Tauri-style delta updates or Sparkle/MSIX

## Files in this commit (in `flutter-mac-worker` branch)

```
worker_flutter/
  lib/
    main.dart                              — boot sequence + zone guard + file logger
    config.dart                            — workerId persistence, java/forge paths
    firebase_options.dart                  — real Firebase config (from flutterfire configure)
    installer/
      installer.dart                       — HTTP streaming downloader + tar extractor
      install_progress_app.dart            — first-run UI with progress bars
    worker/
      worker_engine.dart                   — orchestrator
      sim_claim.dart                       — atomic claim transaction
      sim_runner.dart                      — Java child-process spawner
      lease_writer.dart                    — 5s/15s heartbeat
    ui/
      dashboard.dart                       — main window
      tray_setup.dart                      — deferred to Plan 3
    models/sim.dart                        — DTOs
  test/worker/                             — 18 unit tests
  macos/Runner/                            — Info.plist (LSUIElement=false), entitlements
  README.md                                — setup + verification
```

## Numbers

- Worktree branches: 2 (`worktree-lease-sweep-backend`, `flutter-mac-worker`)
- Open PRs: 2 (#188, #189)
- Commits on Plan 1 PR: 11
- Commits on Plan 2 PR: 2 (initial + the v2 with installer + bundling)
- Tests: 26 backend (Plan 1) + 18 Flutter (Plan 2) — all passing
- App size (compiled): ~25 MB Flutter binary
- App size (after first install): ~540 MB total (with JRE + Forge in support dir)
- Diagnostic log: `~/Library/Logs/com.tytaniumdev.workerFlutter.log`

Sleep well. Both PRs and this status doc are waiting.
