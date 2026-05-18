# Flutter Worker Sentry Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `sentry_flutter` into the macOS/Windows desktop worker so unhandled crashes, known failure sites (sign-in, installer, engine start, worker runtime), and release-health sessions report to a new `magic-bracket-worker` Sentry project, with Dart debug symbols uploaded from CI.

**Architecture:** `SentryFlutter.init(appRunner: _appMain)` replaces the manual `FlutterError.onError` / `PlatformDispatcher.onError` / `runZonedGuarded` hooks in `main.dart`. A small `Telemetry` helper centralizes breadcrumb + capture calls with a required `category` tag that downstream alert rules filter on. DSN + symbol-upload auth come from Doppler via `--dart-define` and env in `.github/workflows/release-worker.yml`.

**Tech Stack:** Flutter (Dart 3.11), `sentry_flutter`, `sentry_dart_plugin` (dev), existing Doppler-backed release workflow.

**Spec:** `docs/superpowers/specs/2026-05-14-flutter-worker-sentry-design.md`

---

## File Map

**Create:**
- `worker_flutter/lib/telemetry.dart` — category enum, `Telemetry.breadcrumb`, `Telemetry.captureError`, `scrubPii` (also exported for the no-DSN-aware `buildSentryOptions`).
- `worker_flutter/lib/sentry_setup.dart` — `buildSentryOptions(...)` configures `SentryFlutterOptions`. Pure, testable.
- `worker_flutter/test/telemetry_test.dart`
- `worker_flutter/test/sentry_options_test.dart`
- `worker_flutter/docs/sentry-setup.md` — manual setup steps.

**Modify:**
- `worker_flutter/pubspec.yaml` — add `sentry_flutter` runtime dep + `sentry_dart_plugin` dev dep + `sentry:` config section.
- `worker_flutter/lib/main.dart` — wrap with `SentryFlutter.init(appRunner: _appMain)`, drop manual hooks, replace `_log()` boot markers with a `_trace()` helper that does both, add `captureError` calls to Firebase-init and engine-start failure paths.
- `worker_flutter/lib/auth/auth_service.dart` — wrap both sign-in flows' `FirebaseAuthException` and generic catches with `Telemetry.captureError(..., category: signIn)`.
- `worker_flutter/lib/installer/installer.dart` — capture at each existing failure throw site (download / extract / SHA mismatch / manifest fetch).
- `worker_flutter/lib/worker/worker_engine.dart` — replace the three existing `catch` blocks' silent logs with captures.
- `.github/workflows/release-worker.yml` — add Doppler keys, pass `--dart-define`s, add `--obfuscate --split-debug-info`, run `dart run sentry_dart_plugin`.

---

## Task 1: Add Sentry dependencies

**Files:**
- Modify: `worker_flutter/pubspec.yaml`

- [ ] **Step 1: Add runtime + dev deps**

In `worker_flutter/pubspec.yaml`, under `dependencies:` (alphabetical-ish location, near the other Firebase entries), add:

```yaml
  # Crash + session reporting. DSN is provided at build time via
  # --dart-define=SENTRY_DSN=... — empty in dev means no-op.
  sentry_flutter: ^8.10.0
```

Under `dev_dependencies:` add:

```yaml
  # Uploads Dart obfuscation debug-info to Sentry so production stack
  # traces deobfuscate. Runs in CI only (no-op without SENTRY_AUTH_TOKEN).
  sentry_dart_plugin: ^2.0.0
```

At the bottom of the file (sibling of `flutter:`, `dependencies:`), add a top-level `sentry:` section:

```yaml
sentry:
  project: magic-bracket-worker
  org: tytaniumdev
  upload_debug_symbols: true
  upload_source_maps: false
  upload_sources: true
  log_level: info
  # release + auth_token come from $SENTRY_RELEASE / $SENTRY_AUTH_TOKEN
  # exported by the release workflow.
```

- [ ] **Step 2: Resolve deps**

Run: `cd worker_flutter && flutter pub get`
Expected: deps resolve, `pubspec.lock` updated, no errors. If `sentry_flutter` requires a Dart SDK constraint bump, note it and skip — the current `^3.11.5` constraint should satisfy `sentry_flutter ^8.x`.

- [ ] **Step 3: Commit**

```bash
git add worker_flutter/pubspec.yaml worker_flutter/pubspec.lock
git commit -m "build(worker): add sentry_flutter + sentry_dart_plugin"
```

---

## Task 2: Build `Telemetry` helper (TDD)

**Files:**
- Create: `worker_flutter/lib/telemetry.dart`
- Create: `worker_flutter/test/telemetry_test.dart`

- [ ] **Step 1: Write the failing test**

`worker_flutter/test/telemetry_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:worker_flutter/telemetry.dart';

void main() {
  group('Telemetry.scrubPii', () {
    test('redacts email-shaped strings in event extra', () {
      final event = SentryEvent(
        message: const SentryMessage('hi'),
        extra: <String, dynamic>{
          'note': 'user contacted me at someone@example.com about it',
          'okField': 'no pii here',
        },
      );
      final scrubbed = scrubPii(event);
      expect(scrubbed!.extra!['note'], contains('[redacted-email]'));
      expect(scrubbed.extra!['note'], isNot(contains('someone@example.com')));
      expect(scrubbed.extra!['okField'], 'no pii here');
    });

    test('redacts known PII keys', () {
      final event = SentryEvent(
        message: const SentryMessage('hi'),
        extra: <String, dynamic>{
          'email': 'a@b.com',
          'uid': 'xyz',
          'displayName': 'Tyler',
          'safe': 'keep me',
        },
      );
      final scrubbed = scrubPii(event)!;
      expect(scrubbed.extra!['email'], '[redacted]');
      expect(scrubbed.extra!['uid'], '[redacted]');
      expect(scrubbed.extra!['displayName'], '[redacted]');
      expect(scrubbed.extra!['safe'], 'keep me');
    });

    test('strips user object', () {
      final event = SentryEvent(
        message: const SentryMessage('hi'),
        user: SentryUser(id: 'abc', email: 'x@y.com'),
      );
      final scrubbed = scrubPii(event)!;
      expect(scrubbed.user, isNull);
    });
  });

  group('TelemetryCategory', () {
    test('snake_case rendering', () {
      expect(TelemetryCategory.signIn.tagValue, 'sign_in');
      expect(TelemetryCategory.engineStart.tagValue, 'engine_start');
      expect(TelemetryCategory.firebaseInit.tagValue, 'firebase_init');
      expect(TelemetryCategory.boot.tagValue, 'boot');
    });
  });
}
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd worker_flutter && flutter test test/telemetry_test.dart`
Expected: FAIL — `telemetry.dart` doesn't exist.

- [ ] **Step 3: Write `telemetry.dart`**

`worker_flutter/lib/telemetry.dart`:

```dart
import 'package:sentry_flutter/sentry_flutter.dart';

/// Stable tag values are written as snake_case so they're easy to
/// filter on in Sentry alert rules.
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

extension TelemetryCategoryTag on TelemetryCategory {
  String get tagValue {
    switch (this) {
      case TelemetryCategory.boot:
        return 'boot';
      case TelemetryCategory.firebaseInit:
        return 'firebase_init';
      case TelemetryCategory.signIn:
        return 'sign_in';
      case TelemetryCategory.installer:
        return 'installer';
      case TelemetryCategory.engineStart:
        return 'engine_start';
      case TelemetryCategory.engineRuntime:
        return 'engine_runtime';
      case TelemetryCategory.autoUpdater:
        return 'auto_updater';
      case TelemetryCategory.tray:
        return 'tray';
    }
  }
}

/// Thin convenience wrapper around `Sentry.addBreadcrumb` and
/// `Sentry.captureException` so call sites stay readable and the
/// `category` tag is impossible to forget.
class Telemetry {
  Telemetry._();

  static void breadcrumb(
    TelemetryCategory category,
    String message, {
    Map<String, dynamic>? data,
  }) {
    Sentry.addBreadcrumb(
      Breadcrumb(
        category: category.tagValue,
        message: message,
        data: data,
        level: SentryLevel.info,
      ),
    );
  }

  static Future<void> captureError(
    Object error,
    StackTrace? stack, {
    required TelemetryCategory category,
    Map<String, String>? tags,
    Map<String, dynamic>? extra,
  }) async {
    await Sentry.captureException(
      error,
      stackTrace: stack,
      withScope: (scope) {
        scope.setTag('category', category.tagValue);
        if (tags != null) {
          tags.forEach(scope.setTag);
        }
        if (extra != null) {
          extra.forEach(scope.setExtra);
        }
      },
    );
  }
}

/// Matches typical email addresses. Conservative — we err on the side
/// of redacting too eagerly rather than leaking PII into Sentry.
final _emailRegex = RegExp(
  r'[\w._%+-]+@[\w.-]+\.[a-zA-Z]{2,}',
);

const _piiKeys = <String>{
  'email',
  'mail',
  'displayName',
  'display_name',
  'uid',
  'userId',
  'user_id',
};

/// `beforeSend` hook. Drops the user object and redacts known PII in
/// extras / breadcrumb data. Synchronous — Sentry calls it on the same
/// isolate as the capture.
SentryEvent? scrubPii(SentryEvent event, {Hint? hint}) {
  // event is immutable-ish; copyWith for the user clear, then mutate
  // the extra/breadcrumb maps in place (they're not frozen).
  final cleaned = event.copyWith(user: null);

  final extra = cleaned.extra;
  if (extra != null) {
    for (final key in extra.keys.toList()) {
      if (_piiKeys.contains(key)) {
        extra[key] = '[redacted]';
        continue;
      }
      final value = extra[key];
      if (value is String && _emailRegex.hasMatch(value)) {
        extra[key] = value.replaceAll(_emailRegex, '[redacted-email]');
      }
    }
  }

  final breadcrumbs = cleaned.breadcrumbs;
  if (breadcrumbs != null) {
    for (final crumb in breadcrumbs) {
      final data = crumb.data;
      if (data == null) continue;
      for (final key in data.keys.toList()) {
        if (_piiKeys.contains(key)) {
          data[key] = '[redacted]';
          continue;
        }
        final value = data[key];
        if (value is String && _emailRegex.hasMatch(value)) {
          data[key] = value.replaceAll(_emailRegex, '[redacted-email]');
        }
      }
    }
  }

  return cleaned;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd worker_flutter && flutter test test/telemetry_test.dart`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker_flutter/lib/telemetry.dart worker_flutter/test/telemetry_test.dart
git commit -m "feat(worker): add Telemetry helper + PII scrubber"
```

---

## Task 3: Build `buildSentryOptions` (TDD)

**Files:**
- Create: `worker_flutter/lib/sentry_setup.dart`
- Create: `worker_flutter/test/sentry_options_test.dart`

- [ ] **Step 1: Write the failing test**

`worker_flutter/test/sentry_options_test.dart`:

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:worker_flutter/sentry_setup.dart';

void main() {
  group('configureSentryOptions', () {
    test('disables performance + profiling, enables session tracking', () {
      final options = SentryFlutterOptions()..dsn = 'https://example@sentry.io/1';
      configureSentryOptions(
        options,
        dsn: 'https://example@sentry.io/1',
        release: 'worker_flutter@0.1.0+42',
        gitSha: 'abc1234',
      );
      expect(options.tracesSampleRate, 0);
      expect(options.profilesSampleRate, 0);
      expect(options.enableAutoSessionTracking, isTrue);
      expect(options.sendDefaultPii, isFalse);
      expect(options.release, 'worker_flutter@0.1.0+42');
      expect(options.dist, 'abc1234');
      expect(
        options.environment,
        kDebugMode ? 'development' : 'production',
      );
    });

    test('empty DSN leaves options safe (no-op mode)', () {
      final options = SentryFlutterOptions();
      configureSentryOptions(
        options,
        dsn: '',
        release: 'worker_flutter@dev',
        gitSha: 'local',
      );
      // Empty DSN: SDK treats this as disabled. We still expect the
      // function to set the safety flags so a misconfigured CI doesn't
      // accidentally enable perf monitoring.
      expect(options.tracesSampleRate, 0);
      expect(options.profilesSampleRate, 0);
      expect(options.sendDefaultPii, isFalse);
    });

    test('attaches beforeSend that strips user', () {
      final options = SentryFlutterOptions();
      configureSentryOptions(
        options,
        dsn: 'https://example@sentry.io/1',
        release: 'r',
        gitSha: 's',
      );
      final cb = options.beforeSend;
      expect(cb, isNotNull);
      final input = SentryEvent(
        message: const SentryMessage('x'),
        user: SentryUser(id: 'u', email: 'a@b.com'),
      );
      final out = cb!(input);
      // beforeSend is FutureOr<SentryEvent?>; await to normalize.
      expect(out, isNotNull);
    });
  });
}
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd worker_flutter && flutter test test/sentry_options_test.dart`
Expected: FAIL — `sentry_setup.dart` missing.

- [ ] **Step 3: Write `sentry_setup.dart`**

`worker_flutter/lib/sentry_setup.dart`:

```dart
import 'package:flutter/foundation.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'telemetry.dart';

/// Configure a [SentryFlutterOptions] instance with the worker's
/// crash-reporting policy. Extracted from `main.dart` so it's
/// unit-testable without booting Flutter.
///
/// - No performance / profiling.
/// - Auto session tracking on (drives release health).
/// - PII scrubbing via [scrubPii] in `beforeSend`.
/// - DSN may be empty: the SDK treats that as disabled, which is the
///   behavior we want for local dev builds that lack `--dart-define`.
void configureSentryOptions(
  SentryFlutterOptions options, {
  required String dsn,
  required String release,
  required String gitSha,
}) {
  options.dsn = dsn;
  options.release = release;
  options.dist = gitSha;
  options.environment = kDebugMode ? 'development' : 'production';
  options.tracesSampleRate = 0;
  options.profilesSampleRate = 0;
  options.enableAutoSessionTracking = true;
  options.autoSessionTrackingInterval = const Duration(seconds: 30);
  options.sendDefaultPii = false;
  options.beforeSend = (event, {hint}) => scrubPii(event, hint: hint);
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd worker_flutter && flutter test test/sentry_options_test.dart`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker_flutter/lib/sentry_setup.dart worker_flutter/test/sentry_options_test.dart
git commit -m "feat(worker): add configureSentryOptions builder"
```

---

## Task 4: Wire `SentryFlutter.init` in main.dart

**Files:**
- Modify: `worker_flutter/lib/main.dart`

- [ ] **Step 1: Replace `main()` body**

In `worker_flutter/lib/main.dart`, replace the existing `main()` function and its three error hooks with:

```dart
Future<void> main() async {
  await _initFileLogger();
  _log('main() started');

  const dsn = String.fromEnvironment('SENTRY_DSN', defaultValue: '');
  const release = String.fromEnvironment(
    'SENTRY_RELEASE',
    defaultValue: 'worker_flutter@dev',
  );
  const gitSha = String.fromEnvironment('GIT_SHA', defaultValue: 'local');

  await SentryFlutter.init(
    (options) {
      configureSentryOptions(
        options,
        dsn: dsn,
        release: release,
        gitSha: gitSha,
      );
      // Also tee Sentry-captured events into the local file log so
      // a user grabbing ~/Library/Logs/... still sees them.
      final upstream = options.beforeSend;
      options.beforeSend = (event, {hint}) {
        _log('Sentry capture: ${event.message?.formatted ?? event.throwable}');
        return upstream != null ? upstream(event, hint: hint) : event;
      };
    },
    appRunner: _appMain,
  );
}
```

Add imports near the top:

```dart
import 'package:sentry_flutter/sentry_flutter.dart';

import 'sentry_setup.dart';
import 'telemetry.dart';
```

- [ ] **Step 2: Remove the redundant error hooks**

The Sentry SDK installs `FlutterError.onError`, `PlatformDispatcher.onError`, and the zone-error handler itself (`appRunner` runs `_appMain` inside its own guarded zone). Delete these three blocks from the OLD `main()` body — they're now redundant. The file logger still logs them because `beforeSend` writes via `_log`.

The old `runZonedGuarded(_appMain, ...)` wrapper is also removed — `appRunner: _appMain` replaces it.

- [ ] **Step 3: Add captures at known failure paths**

In `_appMain`, replace the existing Firebase init catch with:

```dart
} catch (e, st) {
  firebaseInitError = e.toString();
  _log('Firebase init failed: $e');
  await Telemetry.captureError(
    e,
    st,
    category: TelemetryCategory.firebaseInit,
    extra: {'projectId': fbOpts.projectId},
  );
}
```

In `_startEngineSafe`, replace the silent catch:

```dart
} catch (e, st) {
  _log('Engine start FAILED (caught): $e\n$st');
  await Telemetry.captureError(
    e,
    st,
    category: TelemetryCategory.engineStart,
  );
}
```

In `_initAutoUpdater`'s catch, add a breadcrumb (not a capture — offline is normal):

```dart
} catch (e, st) {
  _log('AutoUpdater init failed (non-fatal): $e\n$st');
  Telemetry.breadcrumb(
    TelemetryCategory.autoUpdater,
    'AutoUpdater init failed',
    data: {'error': e.toString()},
  );
}
```

In the tray-init try/catch (`_bootEngine`), add a breadcrumb only:

```dart
} catch (e, st) {
  _log('Boot: tray init failed (non-fatal): $e\n$st');
  Telemetry.breadcrumb(
    TelemetryCategory.tray,
    'Tray init failed',
    data: {'error': e.toString()},
  );
}
```

- [ ] **Step 4: Add a `_trace` boot-phase helper**

Replace the small number of boot-phase `_log('Boot: ...')` calls in `_bootEngine`, `_appMain`, `_routeToMode`, `_bootMode`, `_bootOffline` with a helper that adds a breadcrumb:

```dart
void _trace(String message) {
  _log(message);
  Telemetry.breadcrumb(TelemetryCategory.boot, message);
}
```

Then update the boot-phase `_log` call sites in `main.dart` (those that describe phase transitions: `'Initializing window_manager'`, `'window ready, shown'`, `'Boot: deferring auth to AuthGate'`, `'Boot: constructing WorkerEngine'`, `'Boot: tray initialized'`, `'Boot: runApp'`, `'Boot: runApp returned'`, `'Routing to remembered mode: ...'`, `'No remembered mode; showing picker'`, `'Boot offline: ...'`) to call `_trace(...)` instead. Leave non-phase `_log` calls (installer progress, etc.) untouched — those are noisy and don't need breadcrumbs.

- [ ] **Step 5: Run analyzer + tests**

Run: `cd worker_flutter && flutter analyze`
Expected: no errors. (Some `info` warnings tolerated — only `error`/`warning` block.)

Run: `cd worker_flutter && flutter test`
Expected: all existing tests still pass + the two new test files pass.

- [ ] **Step 6: Commit**

```bash
git add worker_flutter/lib/main.dart
git commit -m "feat(worker): initialize Sentry + breadcrumbs in main"
```

---

## Task 5: Capture sign-in failures

**Files:**
- Modify: `worker_flutter/lib/auth/auth_service.dart`

- [ ] **Step 1: Wrap `_signInNative`'s exception path**

Replace the catch block in `_signInNative`:

```dart
} on FirebaseAuthException catch (e, st) {
  if (_cancelCodes.contains(e.code)) {
    throw const AuthCancelledException();
  }
  await Telemetry.captureError(
    e,
    st,
    category: TelemetryCategory.signIn,
    tags: {
      'platform': Platform.operatingSystem,
      'provider': 'google',
      'error_code': e.code,
    },
  );
  rethrow;
}
```

- [ ] **Step 2: Wrap `_signInDesktop`'s exception path**

Same pattern in `_signInDesktop`'s `signInWithCredential` catch, plus wrap the generic `try { tokens = await oauth.signIn(); }` in a try/capture that lets `AuthCancelledException` through:

```dart
final OAuthTokens tokens;
try {
  tokens = await oauth.signIn();
} on AuthCancelledException {
  rethrow;
} catch (e, st) {
  await Telemetry.captureError(
    e,
    st,
    category: TelemetryCategory.signIn,
    tags: {
      'platform': Platform.operatingSystem,
      'provider': 'google',
      'phase': 'pkce',
    },
  );
  rethrow;
}
```

(Adjust `OAuthTokens` to the actual type returned by `DesktopOAuth.signIn()` — read `desktop_oauth.dart` to confirm. If it's `Future<DesktopOAuthTokens>` use that name.)

Then the existing `signInWithCredential` catch:

```dart
} on FirebaseAuthException catch (e, st) {
  if (_cancelCodes.contains(e.code)) {
    throw const AuthCancelledException();
  }
  await Telemetry.captureError(
    e,
    st,
    category: TelemetryCategory.signIn,
    tags: {
      'platform': Platform.operatingSystem,
      'provider': 'google',
      'error_code': e.code,
      'phase': 'firebase_credential',
    },
  );
  rethrow;
}
```

Add the import:

```dart
import '../telemetry.dart';
```

- [ ] **Step 3: Run tests**

Run: `cd worker_flutter && flutter test test/auth/`
Expected: existing `auth_service_test.dart` still passes. If it asserts no Sentry side-effect, it'll need a small mock (see Step 4) — but most likely the existing test injects a fake `FirebaseAuth` and doesn't exercise the rethrow path, in which case it stays green.

- [ ] **Step 4: If existing tests break**

If `auth_service_test.dart` exercises the rethrow path, Sentry will try to send and fail in test (no SDK init). Two options, prefer the first:

a) **Run tests through `Sentry.init` no-op** — call `await Sentry.init((o) => o.dsn = '')` in the test's `setUpAll`. The no-op SDK accepts captures and drops them.

b) Skip if the test doesn't actually test the failure path. Inspect first.

- [ ] **Step 5: Commit**

```bash
git add worker_flutter/lib/auth/auth_service.dart worker_flutter/test/auth/
git commit -m "feat(worker): capture sign-in failures to Sentry"
```

---

## Task 6: Capture installer + worker engine failures

**Files:**
- Modify: `worker_flutter/lib/installer/installer.dart`
- Modify: `worker_flutter/lib/worker/worker_engine.dart`

- [ ] **Step 1: Installer captures**

Read `worker_flutter/lib/installer/installer.dart` and find every `throw` site for failures (download non-200, SHA mismatch, manifest fetch failure, extract failure). At each throw, prepend a `Telemetry.captureError` call. Example pattern:

```dart
} catch (e, st) {
  await Telemetry.captureError(
    e,
    st,
    category: TelemetryCategory.installer,
    extra: {'stage': 'forge_download', 'url': url},
  );
  rethrow;
}
```

Or where errors are thrown explicitly:

```dart
if (resp.statusCode != 200) {
  final err = InstallerException('forge download failed: ${resp.statusCode}');
  await Telemetry.captureError(
    err,
    StackTrace.current,
    category: TelemetryCategory.installer,
    extra: {'stage': 'forge_download', 'status': resp.statusCode},
  );
  throw err;
}
```

Use whichever shape matches the existing code. Add `import '../telemetry.dart';` at the top.

- [ ] **Step 2: WorkerEngine captures**

In `worker_flutter/lib/worker/worker_engine.dart`, locate the three existing `catch (e)` blocks (lines ~126, ~156, ~290 in the snapshot — verify after edit). Convert each to `catch (e, st)` and add a `Telemetry.captureError(e, st, category: TelemetryCategory.engineRuntime)` call before the existing `_log`/swallow. Do NOT change the catch's swallow behavior — the engine survives single failures and retries; we just want to observe them.

Add `import '../telemetry.dart';` at the top.

- [ ] **Step 3: Run analyzer + tests**

Run: `cd worker_flutter && flutter analyze && flutter test`
Expected: all green. Existing `worker_engine_error_paths_test.dart` may need the same no-op-Sentry shim from Task 5 Step 4 if it triggers the captured paths.

- [ ] **Step 4: Commit**

```bash
git add worker_flutter/lib/installer/installer.dart worker_flutter/lib/worker/worker_engine.dart worker_flutter/test/
git commit -m "feat(worker): capture installer + engine runtime failures"
```

---

## Task 7: Add no-op Sentry to test bootstrap (if needed)

**Files:**
- Modify: `worker_flutter/test/` setup files for any tests that now flow through `Telemetry.captureError`.

- [ ] **Step 1: Identify affected tests**

After Tasks 5-6, run `cd worker_flutter && flutter test`. Any failing tests are the ones that need the bootstrap.

- [ ] **Step 2: Add bootstrap**

For each affected test file, add at the top of `main()`:

```dart
setUpAll(() async {
  await Sentry.init((o) {
    o.dsn = '';
    o.tracesSampleRate = 0;
  });
});
```

Import: `import 'package:sentry_flutter/sentry_flutter.dart';`

The empty DSN keeps the SDK in no-op mode; captures become drops. This avoids touching production code with `kIsTest`-style guards.

- [ ] **Step 3: Run tests**

Run: `cd worker_flutter && flutter test`
Expected: all green.

- [ ] **Step 4: Commit (only if files were touched)**

```bash
git add worker_flutter/test/
git commit -m "test(worker): bootstrap Sentry no-op for capture-touching tests"
```

---

## Task 8: Wire `release-worker.yml`

**Files:**
- Modify: `.github/workflows/release-worker.yml`

- [ ] **Step 1: Add Doppler keys to both build jobs**

In `build-macos` and `build-windows` jobs, extend the `KEYS` JSON array passed to the Doppler step. Find the existing `KEYS='[ ... ]'` block and add:

```
    "SENTRY_DSN_WORKER",
    "SENTRY_AUTH_TOKEN_WORKER"
```

(Comma placement matters — add the comma to whatever's currently the last entry.)

- [ ] **Step 2: Pass `--dart-define`s to `flutter build`**

Locate the `flutter build macos` and `flutter build windows` steps. Modify the build command to:

```bash
flutter build macos --release \
  --obfuscate \
  --split-debug-info=build/debug-info/macos \
  --dart-define=SENTRY_DSN=$SENTRY_DSN_WORKER \
  --dart-define=SENTRY_RELEASE=worker_flutter@${{ needs.version.outputs.version }} \
  --dart-define=GIT_SHA=${{ github.sha }}
```

And:

```bash
flutter build windows --release \
  --obfuscate \
  --split-debug-info=build/debug-info/windows \
  --dart-define=SENTRY_DSN=$SENTRY_DSN_WORKER \
  --dart-define=SENTRY_RELEASE=worker_flutter@${{ needs.version.outputs.version }} \
  --dart-define=GIT_SHA=${{ github.sha }}
```

Read the existing yml first — the build command may be inside a larger fastlane / scripts wrapper on macOS. If so, edit the wrapper script instead, but the flags are the same.

- [ ] **Step 3: Add Sentry upload step**

After each `flutter build` step, add:

```yaml
- name: Upload Dart debug symbols to Sentry
  if: env.SENTRY_AUTH_TOKEN_WORKER != ''
  working-directory: worker_flutter
  env:
    SENTRY_AUTH_TOKEN: ${{ env.SENTRY_AUTH_TOKEN_WORKER }}
    SENTRY_RELEASE: worker_flutter@${{ needs.version.outputs.version }}
  run: dart run sentry_dart_plugin
  continue-on-error: true   # don't fail a release if Sentry is down
```

- [ ] **Step 4: Lint the workflow**

Run: `gh workflow view release-worker.yml` — purely a syntax sanity check via the GH API; doesn't execute. If `gh` complains about parsing, fix.

Alternatively run `actionlint` locally if installed; otherwise skip — the actual workflow run will surface errors.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-worker.yml
git commit -m "ci(worker): pass Sentry DSN to build + upload debug symbols"
```

---

## Task 9: Write manual setup doc

**Files:**
- Create: `worker_flutter/docs/sentry-setup.md`

- [ ] **Step 1: Write the doc**

`worker_flutter/docs/sentry-setup.md`:

```markdown
# Sentry setup — worker_flutter desktop

The Flutter worker reports crashes and known failures to Sentry. This
doc covers the one-time manual setup an operator performs in the
Sentry UI + Doppler. The code side ships in PR #N.

## 1. Create the Sentry project

In Sentry under the `tytaniumdev` organization:

1. **Projects → Create Project**
   - Platform: **Flutter**
   - Team: existing
   - Name: `magic-bracket-worker`
2. Copy the DSN shown on the next screen.

## 2. Store DSN + auth token in Doppler

In Doppler, project `blinkbreak`, config `prd`:

1. Add `SENTRY_DSN_WORKER` = the DSN from step 1.
2. **Settings → Auth Tokens → Create new internal integration token** in
   Sentry, scoped to `magic-bracket-worker` with permissions
   `project:releases` + `project:write`.
3. Add `SENTRY_AUTH_TOKEN_WORKER` = the new token to Doppler.

The release workflow reads both via the Doppler step.

## 3. Wire the GitHub integration

In Sentry → **Settings → Integrations → GitHub**:

1. Install / authorize the integration for
   `TytaniumDev/MagicBracketSimulator` if not already.
2. Enable issue creation on the `magic-bracket-worker` project.

## 4. Create alert rules

For each rule below: Sentry → **Alerts → Create Alert → Issues**.

### Rule 1 — Error Spike (catch-all)

- **When:** An issue is seen more than 10 times in 1 hour.
- **If:** (no filter)
- **Then:** Create a GitHub issue with labels `bug,sentry,worker`.

### Rule 2 — Sign-in Failures

- **When:** A new issue is created.
- **If:** The event's `category` tag equals `sign_in`.
- **Then:** Create a GitHub issue with labels `bug,sentry,worker`.

### Rule 3 — Installer Failures

- **When:** A new issue is created.
- **If:** The event's `category` tag equals `installer`.
- **Then:** Create a GitHub issue with labels `bug,sentry,worker`.

### Rule 4 — Engine Start Failures

- **When:** A new issue is created.
- **If:** The event's `category` tag equals `engine_start`.
- **Then:** Create a GitHub issue with labels `bug,sentry,worker`.

## 5. Verify

After the next release-worker run succeeds:

1. Sentry → Releases — confirm the new `worker_flutter@<version>+<build>`
   release shows with `Dart Debug Information Files` uploaded.
2. Trigger a controlled error in dev (e.g. set an invalid Firebase
   project) and confirm it shows up in Sentry within ~30 seconds.
```

- [ ] **Step 2: Commit**

```bash
git add worker_flutter/docs/sentry-setup.md
git commit -m "docs(worker): add Sentry manual setup checklist"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full analyzer + test pass**

Run: `cd worker_flutter && flutter analyze`
Expected: no errors, no warnings.

Run: `cd worker_flutter && flutter test`
Expected: all tests pass (existing + new).

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/worker-sentry
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main --head feat/worker-sentry \
  --title "feat(worker): add Sentry logging to desktop apps" \
  --body "$(cat docs/superpowers/specs/2026-05-14-flutter-worker-sentry-design.md | head -40)

## Manual setup required after merge

See worker_flutter/docs/sentry-setup.md. Until the operator completes:
- Create magic-bracket-worker Sentry project
- Add SENTRY_DSN_WORKER + SENTRY_AUTH_TOKEN_WORKER to Doppler
- Configure GitHub integration + 4 alert rules

…the SDK runs in no-op mode (graceful skip on empty DSN, same as the API).

## Test plan
- [x] flutter analyze: clean
- [x] flutter test: green
- [ ] Manual: build with --dart-define=SENTRY_DSN=<test-dsn>, force a Firebase init error, confirm event lands in Sentry
- [ ] Manual: confirm release shows in Sentry → Releases with Dart Debug Files uploaded after first release-worker run

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Merge**

Wait for CI green, then:

```bash
gh pr merge --squash --auto
```

(Repo uses auto-approve + automerge-label workflows; `--auto` enables auto-merge once branch protection is satisfied. If the user merges manually, that's fine too.)
