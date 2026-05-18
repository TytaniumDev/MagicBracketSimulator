# Flutter Worker Desktop App — Sentry Integration

**Date:** 2026-05-14
**Status:** Approved
**Surface:** `worker_flutter/` (macOS + Windows desktop builds)

## Motivation

The Flutter desktop worker currently writes diagnostics only to
`~/Library/Logs/com.tytaniumdev.magicBracketSimulator.log` (macOS) or
`%LocalAppData%\com.tytaniumdev.magicBracketSimulator\Logs\...` (Windows).
A user hitting the recent `[firebase_auth/null-error] Host platform
returned null value for non-null return value` on macOS sign-in had to
send a screenshot — there is no automatic reporting path. Adding Sentry
gives the same crash-reporting surface the Next.js API already has
(`@sentry/nextjs`, project `magic-bracket-api`) and lets us learn about
desktop crashes without waiting for a user to report them.

## Scope

### In scope

- Initialize `sentry_flutter` in the desktop worker.
- Replace the three manual error hooks in `main.dart`
  (`FlutterError.onError`, `PlatformDispatcher.onError`,
  `runZonedGuarded`) with the SDK's automatic equivalents while keeping
  the existing file logger.
- Add a `Telemetry` helper for breadcrumb + capture calls with required
  `category` tagging.
- Instrument the boot sequence (every current `_log` call becomes a
  breadcrumb) and explicitly capture errors at known failure sites:
  Firebase init, sign-in, installer, engine start, worker engine.
- Release health (auto session tracking).
- Source map / Dart debug symbol upload from CI via the
  `sentry_dart_plugin`.
- A new `magic-bracket-worker` Sentry project, with four alert rules
  that create GitHub issues mirroring the API project's setup.
- Tests: unit-test the `Telemetry` helper and the no-DSN graceful path.

### Out of scope

- Performance monitoring (`tracesSampleRate: 0`).
- Profiling (`profilesSampleRate: 0`).
- User identification: events stay anonymous. `sendDefaultPii: false`
  and a `beforeSend` scrubber strip any incidentally captured PII.

## Architecture

### SDK initialization

`main()` becomes:

```dart
Future<void> main() async {
  await _initFileLogger();          // unchanged
  await SentryFlutter.init(
    (o) {
      o.dsn = const String.fromEnvironment('SENTRY_DSN', defaultValue: '');
      o.release = const String.fromEnvironment(
        'SENTRY_RELEASE',
        defaultValue: 'worker_flutter@dev',
      );
      o.dist = const String.fromEnvironment('GIT_SHA', defaultValue: 'local');
      o.environment = kDebugMode ? 'development' : 'production';
      o.tracesSampleRate = 0;
      o.profilesSampleRate = 0;
      o.enableAutoSessionTracking = true;
      o.autoSessionTrackingInterval = const Duration(milliseconds: 30000);
      o.sendDefaultPii = false;
      o.beforeSend = _scrubPii;
    },
    appRunner: _appMain,
  );
}
```

The three error hooks in the existing `main()` are removed: Sentry
installs them itself. The file logger is preserved by calling `_log`
from `_scrubPii` (so every event that reaches Sentry also lands in the
local log).

When `SENTRY_DSN` is empty (local `flutter run`), `SentryFlutter.init`
runs in no-op mode — same graceful-skip pattern the API uses.

### Telemetry helper

`lib/telemetry.dart` exposes two functions and a category enum:

```dart
enum TelemetryCategory {
  boot,
  firebaseInit,
  signIn,
  installer,
  engineStart,
  engineRuntime,
  autoUpdater,
  tray,
}

class Telemetry {
  static void breadcrumb(
    TelemetryCategory category,
    String message, {
    Map<String, Object?>? data,
  });

  static Future<void> captureError(
    Object error,
    StackTrace? stack, {
    required TelemetryCategory category,
    Map<String, String>? tags,
    Map<String, Object?>? extra,
  });
}
```

`category` is required on `captureError` so every event carries a
`category` tag. The alert rules in §"Alerts" filter on that tag.

### Replacing `_log`

The existing `_log(String)` function in `main.dart` stays — call sites
that are pure boot-phase markers (e.g. `_log('main() started')`) gain a
sibling `Telemetry.breadcrumb(TelemetryCategory.boot, 'main() started')`
call. The convention: file logger for the local trail, breadcrumb so
the trail also rides along with any subsequent capture.

For readability we extract a small helper `_trace(category, message)`
inside `main.dart` that does both, so call sites read:

```dart
_trace(TelemetryCategory.boot, 'Initializing window_manager');
```

### Explicit captures

| Site | File | Category | Notes |
|---|---|---|---|
| Firebase init failure | `lib/main.dart` `_appMain` | `firebaseInit` | Includes `projectId` and stub-marker detection in extras. |
| Google sign-in failure | `lib/auth/auth_service.dart` (mac/win/linux paths) | `signIn` | Tags: `platform`, `provider`, `error_code` (the `firebase_auth/...` code). |
| Installer download/extract/SHA failure | `lib/installer/installer.dart` | `installer` | Includes current `progress.stage` in extras. |
| `_startEngineSafe` catch | `lib/main.dart` | `engineStart` | Replaces the silent `_log`-only path. |
| Tray init failure | `lib/main.dart` | `tray` | Breadcrumb only — non-fatal (window is primary UI). |
| AutoUpdater init failure | `lib/main.dart` | `autoUpdater` | Breadcrumb only — offline ≠ error. |
| WorkerEngine catches | `lib/worker/worker_engine.dart` | `engineRuntime` | Each existing `_log`-only catch becomes a `captureError`. |

### PII scrubbing

`_scrubPii(SentryEvent event, Hint hint)`:

1. Sets `event.user = null` (defense — we never set it, but guards
   against future regressions).
2. Walks `event.extra` and the breadcrumb data maps; redacts any value
   that matches an email regex or any key named `email`, `mail`,
   `displayName`, `uid`, `userId`.
3. Returns the event.

Tested by a unit test that constructs a synthetic event with email-in-
extras and verifies it comes back redacted.

## CI / source map upload

### Doppler secrets

Two new Doppler entries under `blinkbreak/prd` (the existing project
the release workflow reads):

| Key | Used by | Scope |
|---|---|---|
| `SENTRY_DSN_WORKER` | `--dart-define=SENTRY_DSN=...` at build | Public-ish; embedded in binary. |
| `SENTRY_AUTH_TOKEN_WORKER` | `sentry_dart_plugin` symbol upload | `project:releases` + `project:write` on `magic-bracket-worker` only. |

Both added to the `KEYS` jq array in `.github/workflows/release-worker.yml`.

### Workflow changes

For both `build-macos` and `build-windows` jobs in `release-worker.yml`:

1. Pull DSN + auth token from Doppler (extend `KEYS`).
2. Compute `SENTRY_RELEASE = worker_flutter@${VERSION}` and
   `GIT_SHA = ${{ github.sha }}`.
3. Build with obfuscation + split debug info:
   ```
   flutter build macos --release \
     --obfuscate \
     --split-debug-info=build/debug-info/macos \
     --dart-define=SENTRY_DSN=$SENTRY_DSN_WORKER \
     --dart-define=SENTRY_RELEASE=$SENTRY_RELEASE \
     --dart-define=GIT_SHA=${{ github.sha }}
   ```
   (Equivalent for `flutter build windows`.)
4. Run `dart run sentry_dart_plugin` after the build to upload the
   debug-info directory + source context for `$SENTRY_RELEASE`. The
   plugin is configured via a `sentry` section in `pubspec.yaml`:
   ```yaml
   sentry:
     project: magic-bracket-worker
     org: tytaniumdev
     upload_debug_symbols: true
     upload_source_maps: false   # Flutter desktop has no JS bundle
     upload_sources: true
     log_level: info
     # release/auth_token read from env vars set by the workflow.
   ```
5. The plugin no-ops locally because `SENTRY_AUTH_TOKEN` is unset on
   developer machines.

## Release health

`enableAutoSessionTracking = true` and a 30s background interval (the
SDK default) — sessions start at app launch and end on background or
exit, so the new project's dashboard shows crash-free-users and
crash-free-sessions automatically. Rolls up per `release` value, which
matches `worker_flutter@${version}+${buildNumber}`.

## Alerts

Four alert rules on `magic-bracket-worker`, all configured with the
Sentry-GitHub integration to create issues in
`TytaniumDev/MagicBracketSimulator` with labels `bug`, `sentry`,
`worker`:

| Rule | Trigger | Action |
|---|---|---|
| Error Spike (catch-all) | Issue seen > 10 times in 1 hour | Create GH issue once per Sentry issue. |
| Sign-in Failures | New issue where `tags[category] = signIn` | Create GH issue on first occurrence. |
| Installer Failures | New issue where `tags[category] = installer` | Create GH issue on first occurrence. |
| Engine Start Failures | New issue where `tags[category] = engineStart` | Create GH issue on first occurrence. |

These are configured manually in the Sentry UI (no Terraform yet). The
click-by-click is documented in `worker_flutter/docs/sentry-setup.md`.

## Testing

Two new test files under `worker_flutter/test/`:

1. **`telemetry_test.dart`**
   - `Telemetry.captureError` sets the `category` tag from the enum
     (snake_case form).
   - `_scrubPii` strips email-shaped strings from event extras and
     known PII-keyed entries (`email`, `mail`, `displayName`, `uid`,
     `userId`).
   - Breadcrumbs carry the category as the Sentry `breadcrumb.category`
     value.

2. **`sentry_options_test.dart`**
   - `buildSentryOptions(dsn: '')` produces an options object that
     `SentryFlutter.init` accepts without throwing (no-op mode).
   - With a non-empty DSN: `enableAutoSessionTracking == true`,
     `tracesSampleRate == 0`, `profilesSampleRate == 0`,
     `sendDefaultPii == false`, `environment` matches the
     `kDebugMode`-derived value.

This is the release-health coverage as well — auto session tracking is
a single options flag.

Local verification: `flutter analyze` (project policy via
`analysis_options.yaml`) and `flutter test` both pass before the PR.

## Manual setup checklist (operator)

Documented in `worker_flutter/docs/sentry-setup.md`. The agent cannot
do these:

1. Create Sentry project `magic-bracket-worker` under `tytaniumdev`.
2. Copy the DSN into Doppler as `SENTRY_DSN_WORKER`.
3. Create an internal-integration auth token with
   `project:releases` + `project:write` scopes on the new project; add
   to Doppler as `SENTRY_AUTH_TOKEN_WORKER`.
4. Wire the Sentry-GitHub integration for the new project, pointing at
   `TytaniumDev/MagicBracketSimulator` with labels `bug`, `sentry`,
   `worker`.
5. Create the four alert rules in the Sentry UI.

Until step 1+2 are done, all Sentry calls are no-ops. The shipping app
still functions; nothing else regresses.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `--obfuscate` breaks a reflection-using package. | Smoke-test the obfuscated build locally before merge: build, launch, sign in, run a sim. If any plugin breaks, drop `--obfuscate` and keep `--split-debug-info` (symbols still upload). |
| Sentry plugin upload fails and breaks releases. | Wrap the plugin step in `continue-on-error: true` for the first release; tighten once we see a green run. |
| DSN gets embedded in a forked binary and someone abuses quota. | Sentry DSNs are designed to be public; rate-limit/inbound filters on the project mitigate. Accepted risk. |
| Breadcrumbs include sensitive data. | `_scrubPii` is the safety net; breadcrumb call sites are explicit and reviewed. |
