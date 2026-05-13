# Desktop app evolution: offline mode + Plan 3 deferrals

**Status:** Design / awaiting implementation
**Author:** Tyler (via Claude)
**Date:** 2026-05-12
**Related:** PR #188 (Plan 1, merged), PR #189 (Plan 2, in review), `docs/superpowers/specs/2026-05-11-flutter-worker-architecture-design.md`

## Goal

Evolve the Flutter desktop worker (PR #189) from "cloud-only worker" into a dual-mode desktop app:

1. **Cloud mode** — the existing worker behavior. Listens to Firestore for sims dispatched by the web frontend, runs them locally, reports results back. Closes Plan 3 deferrals 1–4.
2. **Offline mode** — a fully self-contained client. The user picks a bracket from bundled precons, runs N sims locally, and views results, all without touching Firebase. History persists in a local SQLite DB.

A launch-time picker chooses between modes. The choice can be remembered.

## Sub-projects

Each is implementable independently (with the dependencies noted) so they can ship in any order. The implementation plan will sequence them.

| # | Sub-project | Depends on |
|---|---|---|
| A | **Launch mode picker** — UI that runs before either mode boots | — |
| B | **Cloud mode hardening** — tray re-enable, Google Sign-In re-enable, sim stdout → log upload (Plan 3 #1, 2, 4) | A (to gate Google Sign-In behind "Cloud" choice) |
| C | **Offline mode v1** — full standalone client (deck picker, job run, results, history) | A |
| D | **Code signing + notarization** — Fastlane match + xcconfig + GitHub Actions (Plan 3 #3) | — (independent of A/B/C) |
| E | **Windows build** — scaffolding + manual validation deferred (Plan 3 #5) | D-pattern reused |
| F | **Auto-updater** | D (signing required for safe updates) |

**Out of scope for v1:** offline → cloud sync of historical runs (explicitly chosen separate worlds), Moxfield URL fetch in offline mode (bundled precons only day-1), Linux build.

---

## Architectural overview

```
worker_flutter/lib/
  main.dart                          — entry, file logger, Firebase init guard
  launch/
    mode_picker_screen.dart          — Cloud / Offline picker; persists choice in SharedPreferences
    auth_gate_screen.dart            — Google Sign-In flow (cloud mode only)
  shared/                            — code reused by both modes
    sim_runner.dart                  — (moved from worker/) Java child-process spawner
    config.dart                      — (moved from .) install paths, max capacity
    installer/                       — first-run JRE + Forge install (unchanged)
  cloud/                             — (moved from worker/) existing worker stack
    worker_engine.dart
    sim_claim.dart
    lease_writer.dart
    log_uploader.dart                — NEW: POSTs sim stdout to /api/jobs/:id/logs/simulation
    auth/
      google_sign_in.dart            — NEW: desktop OAuth flow (firebase_auth + google_sign_in)
    ui/
      dashboard.dart                 — existing worker dashboard
      tray_setup.dart                — re-enabled, runs only in cloud mode
  offline/                           — NEW: standalone client
    db/
      app_db.dart                    — drift schema + DAO
      app_db.g.dart                  — generated (build_runner output)
    repository/
      job_repo.dart                  — CRUD on Jobs + Sims
      deck_repo.dart                 — reads bundled precons (precons/ dir)
      settings_repo.dart             — max storage size, etc.
    services/
      offline_runner.dart            — orchestrates SimRunner against local PENDING sims
      storage_pruner.dart            — enforces max storage; deletes oldest first
    ui/
      home_screen.dart               — new run + recent history
      deck_picker_screen.dart        — pick 4 precons
      new_job_screen.dart            — confirm decks + N sims, start
      job_progress_screen.dart       — live progress for current run
      job_results_screen.dart        — mirrors web frontend results (win rate / win-turn distribution / per-sim drill-down)
      history_screen.dart            — all past runs
      settings_screen.dart           — max storage size, clear history, mode picker reset
  macos/
    Runner/Info.plist                — LSUIElement set per mode at runtime (cloud) or false (offline)
    Runner.xcodeproj                 — DEVELOPMENT_TEAM, manual signing for Release (sub-project D)
    fastlane/
      Fastfile                       — sync_certs / sign_macos / notarize / build_release lanes (NEW)
      Matchfile                      — type("developer_id") (NEW)
      Appfile                        — NEW
  pubspec.yaml                       — add: drift, drift_dev (dev), sqlite3_flutter_libs, path, google_sign_in, firebase_auth, tray_manager (re-enabled)
```

The `shared/` reorg is the heaviest internal move. Justified because both modes need SimRunner + WorkerConfig + Installer, and keeping them in `worker/` makes it harder to reason about coupling.

### Launch flow

```
main()
  ├── _initFileLogger()
  ├── Firebase.initializeApp() (graceful failure → SetupRequiredApp)
  ├── windowManager.ensureInitialized()
  ├── WorkerConfig.loadOrInit()
  ├── Installer.isReady()? → install if not, then continue
  │
  ├── SharedPreferences: rememberedMode?
  │     ├── 'cloud'   → CloudBootstrap()
  │     ├── 'offline' → OfflineBootstrap()
  │     └── null      → ModePickerScreen
  │
  ├── ModePickerScreen
  │     ├── [Cloud Sync]   → (optional "remember") → CloudBootstrap()
  │     └── [Offline Mode] → (optional "remember") → OfflineBootstrap()
  │
  ├── CloudBootstrap()   → AuthGate (Google Sign-In) → WorkerEngine + Dashboard + Tray
  └── OfflineBootstrap() → AppDb.open() → HomeScreen
```

### Database schema (drift)

```dart
class Jobs extends Table {
  IntColumn   get id            => integer().autoIncrement()();
  TextColumn  get jobName       => text().nullable()();
  DateTimeColumn get createdAt  => dateTime()();
  IntColumn   get totalSims     => integer()();
  IntColumn   get completedSims => integer().withDefault(const Constant(0))();
  TextColumn  get status        => text().withDefault(const Constant('PENDING'))();
  TextColumn  get deck1Name     => text()();
  TextColumn  get deck2Name     => text()();
  TextColumn  get deck3Name     => text()();
  TextColumn  get deck4Name     => text()();
}

class Sims extends Table {
  IntColumn      get id             => integer().autoIncrement()();
  IntColumn      get jobId          => integer().references(Jobs, #id)();
  IntColumn      get simIndex       => integer()();
  TextColumn     get state          => text().withDefault(const Constant('PENDING'))();
  TextColumn     get winnerDeckName => text().nullable()();
  IntColumn      get winningTurn    => integer().nullable()();
  IntColumn      get durationMs     => integer().nullable()();
  TextColumn     get logRelPath     => text().nullable()();  // path relative to logs dir
  TextColumn     get errorMessage   => text().nullable()();
  DateTimeColumn get startedAt      => dateTime().nullable()();
  DateTimeColumn get completedAt    => dateTime().nullable()();
}

class Settings extends Table {
  TextColumn get key   => text()();
  TextColumn get value => text()();
  @override Set<Column> get primaryKey => {key};
}
```

Sim logs are stored as separate files under `<app-support>/offline-logs/<jobId>/<simIndex>.log` and referenced from `Sims.logRelPath`. The DB stays small; the pruner deletes whole job dirs.

### Storage pruner

Runs:
- On app launch (idle pass).
- After each completed sim (cheap recount; only acts if over cap).
- Background timer every 5 min while app is open.

Algorithm: compute total bytes (DB file + logs dir). If > `settings['maxStorageBytes']`, delete oldest jobs (ORDER BY createdAt ASC) until under cap. Default cap: 10 GB. Configurable in Settings screen with sane bounds (1 GB – 100 GB).

### Sim log upload (cloud mode)

New `LogUploader` class:
- After `SimRunner` completes, `WorkerEngine` calls `LogUploader.upload(sim, logText)`.
- POSTs to `${apiBaseUrl}/api/jobs/${jobId}/logs/simulation` with body `{simId, logText}`.
- Best-effort: failures logged but don't fail the sim — the result is still reported via `reportTerminal()`.
- API base URL stored in `WorkerConfig` (new field), default `https://api.magicbracket.tytaniumdev.com` (or whatever current prod is — TBD: confirm at impl time).

### Google Sign-In (cloud mode)

Use `google_sign_in` package + `firebase_auth` to authenticate via desktop OAuth (browser-popup flow). Wired into `AuthGateScreen` that gates `WorkerEngine.start()` on `currentUser != null`.

Once signed in, the user is identified by `request.auth.uid` for Firestore rules — the SOLO-DEV unauth branches in `firestore.rules` (added in this PR for Plan 2) can then be tightened back to `if isAllowedUser()` only. This tightening is a follow-up commit/PR after Google Sign-In is live in cloud mode AND verified to work.

### Tray (cloud mode)

Re-enable `tray_manager` calls in cloud mode bootstrap only (not offline mode — user is actively interacting there). Tray menu: Show window / Quit / current status / sim count.

### Apple code signing + notarization

Mirror BlinkBreak's Fastlane match pattern, with these adjustments for macOS:

1. **Cert type:** `developer_id` (not `appstore`). Distributes outside the App Store.
2. **Storage:** new directory `developer_id/` in the existing `BlinkBreak-certificates` repo (so we don't manage two cert repos). Optional: rename repo to a generic name in a separate change.
3. **Seed step (run once locally):** `fastlane match developer_id --app_identifier=com.tytaniumdev.workerFlutter`. Requires the user to first create a "Developer ID Application" cert in the Apple Developer portal (or let match create it). This is a manual step — match cannot run unattended for cert creation the very first time.
4. **CI lane (Fastfile):** `sync_certs` → `update_code_signing_settings` for `worker_flutter/macos/Runner.xcodeproj` → `flutter build macos --release` → `notarize` (xcrun notarytool via Fastlane's `notarize` action) → staple → zip → upload artifact.
5. **Credentials:** reuse ASC API key from BlinkBreak (ASC_KEY_ID / ASC_ISSUER_ID / ASC_API_KEY_CONTENT) since same team (F2HXQGU2CC).
6. **Local dev unchanged:** unsigned debug build still works for fast iteration.

### Windows build

Scaffold with `flutter create --platforms=windows .` from `worker_flutter/`. Configure:
- `pubspec.yaml` flutter section: ensure windows enabled.
- Windows-specific code paths in `Installer` (JRE for `x64`/`arm64` from Adoptium, Forge installer .exe vs .tar.bz2 — Forge ships installer-bin-2.0.10.jar that may work cross-platform; **verify at impl time**).
- Code signing on Windows: separate cert (Authenticode). **Deferred to a follow-up** — Windows build ships unsigned for v1; users see SmartScreen warning until then.

### Auto-updater (lowest priority)

Use `auto_updater` package which wraps Sparkle (macOS) and Squirrel (Windows). Requires:
- An update feed (appcast XML) hosted somewhere. Could be a GitHub Releases-driven static feed.
- macOS: signed app + signed appcast.
- Windows: signed installer.

Given the prerequisites (signing first on both platforms), this is parked until D and E are stable.

---

## Open decisions resolved

- **Storage backend:** drift (SQLite). Type-safe Dart, well-supported on macOS+Windows, mature.
- **Offline → cloud sync:** none. Separate worlds.
- **Deck sources in offline v1:** bundled precons only.
- **Results UI fidelity:** mirror the web frontend results page (win rate per deck, win-turn distribution, per-sim log access).
- **History cap:** SQLite + user-configurable, default 10 GB.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Google Sign-In via `firebase_auth_macos` historically crashed natively in unsigned/sandbox-disabled config (the original Plan 3 deferral reason). | Sub-project D (signing) runs first, OR we use `google_sign_in` desktop OAuth flow which doesn't go through firebase_auth's native crash path. Plan to use the latter as a safety net. |
| Developer ID cert doesn't exist in `BlinkBreak-certificates` repo yet (verified 2026-05-12 — only iOS App Store cert present). | Sub-project D explicitly includes a manual "seed cert" step. Fastlane config is written so once the cert exists, the rest is unattended. |
| Drift codegen requires running `build_runner` — first-time setup cost. | Single `pub run build_runner build` step documented in worker_flutter/README. CI runs it before `flutter test`. |
| Refactor of `worker/` → `cloud/` + `shared/` touches many files; risk of breaking the existing PR #189 work. | Refactor lands as one mechanical commit *after* PR #189 merges. Or: rebased into the same PR if not yet merged. |
| Storage pruner deleting active job logs. | Pruner skips jobs with status != COMPLETED/FAILED/CANCELLED. |

## Out of scope (explicit)

- Linux build (not mentioned in Plan 3).
- Cloud → offline sync (one-way only: separate worlds).
- Moxfield URL fetch / raw deck paste in offline v1 (precons only).
- Auto-updater on Windows (requires Windows code signing).
- Migrating existing iOS App Store creds repo to a renamed "tytaniumdev-certificates" generic repo (separate refactor).

---

## Implementation phasing (proposed; refined by `writing-plans`)

**Phase 1 — Cloud mode hardening + launch picker scaffolding (this session):**
- Refactor `worker/` → `cloud/` + `shared/`
- Sim log upload (B-3)
- Tray re-enable (B-1)
- Mode picker UI shell + SharedPreferences persist
- Google Sign-In code path (B-2) — gated behind "Cloud" choice, falls back to no-auth if it fails (preserve current behavior so we never regress)

**Phase 2 — Offline mode v1 (this session if time allows, else next):**
- drift schema + DAO + repositories
- Offline bootstrap + home screen
- Deck picker (precons only)
- Job creation + progress UI
- Results UI mirroring web frontend
- History list
- Settings screen + storage pruner

**Phase 3 — Signing + notarization (after offline mode lands):**
- Fastlane Fastfile + Matchfile + Appfile
- xcconfig updates for manual signing
- GH Actions workflow
- Document "seed cert" one-time step
- First signed + notarized release artifact

**Phase 4 — Windows build (low priority):**
- Scaffold via `flutter create --platforms=windows`
- Validate Installer JRE+Forge path on Windows (likely needs an x64 testbed)
- Ship unsigned for v1

**Phase 5 — Auto-updater (lowest priority):**
- `auto_updater` integration with GitHub Releases appcast
- Skip until 3 + 4 are stable.
