# Magic Bracket Worker

Cross-platform desktop worker for the Magic Bracket Simulator. macOS
and Windows. Picks up bracket jobs from the shared Firestore queue,
spawns headless Forge games via Java, reports results back. Also runs
in offline mode with bundled precons — no cloud account needed.

## Install

Grab the latest build for your platform from
**https://github.com/TytaniumDev/MagicBracketSimulator/releases/latest**.

- **macOS** (`worker_flutter-macos.zip`): unzip, drag the .app to
  /Applications. Developer-ID signed + notarized so Gatekeeper
  accepts it cleanly.
- **Windows** (`worker_flutter-windows.zip`): unzip, run
  `worker_flutter.exe`. First launch trips SmartScreen ("Windows
  protected your PC") — click *More info → Run anyway*. Subsequent
  launches go directly.

Both auto-update from this repo's `appcast.xml`:
- macOS via Sparkle 2 (EdDSA-verified update zips).
- Windows via WinSparkle (DSA-verified update zips).

## On first launch

Pick **Cloud** or **Offline** mode.

- **Cloud** signs in with Google and starts listening for jobs from
  the [web frontend](https://magic-bracket-simulator.web.app).
  Results show up on the public leaderboard.
- **Offline** lets you pick 4 bundled Commander precons and run a
  bracket locally. Results stay on your machine.

The first-ever launch also downloads the Forge runtime (~540 MB
one-time, ~40 seconds on broadband). Subsequent launches skip this.

## Auto-start at login

Dashboard → Worker tab → **Launch at login** toggle. macOS writes a
Login Items entry; Windows drops a `.lnk` in the Startup folder.

## Settings persisted

Per-user, written to the OS's standard app-support dir:

- macOS: `~/Library/Application Support/com.tytaniumdev.magicBracketSimulator/`
- Windows: `%LOCALAPPDATA%\com.tytaniumdev\magicBracketSimulator\`

Includes: worker ID, parallelism capacity, last-picked launch mode,
offline-mode SQLite history (`offline.sqlite`), and the Forge install
itself.

## Developing locally

```bash
cd worker_flutter
flutter pub get
flutter run -d macos      # or: -d windows
```

`flutter test` runs the suite (83 tests at time of writing — auth,
worker engine, offline runner, installer, log uploader). No Firebase
project needed; tests use `fake_cloud_firestore` + `firebase_auth_mocks`.

## Release pipeline

Every push to `main` triggers `.github/workflows/release-worker.yml`,
which builds both platforms in parallel, all-or-nothing publishes to
a `build-<sha7>` GitHub Release. Tagged `worker-v*` pushes produce
the named official releases.

See `worker_flutter/macos/fastlane/SETUP.md` for the macOS signing
pipeline detail.
