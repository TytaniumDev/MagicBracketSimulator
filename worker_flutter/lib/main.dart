import 'dart:async';
import 'dart:io';

import 'package:auto_updater/auto_updater.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:window_manager/window_manager.dart';

import 'auth/auth_gate_screen.dart';
import 'auth/auth_service.dart';
import 'config.dart';
import 'firebase_options.dart';
import 'installer/install_progress_app.dart';
import 'installer/installer.dart';
import 'launch/auto_start_service.dart';
import 'launch/mode_picker_screen.dart';
import 'macos/activation_policy.dart';
import 'offline/offline_app.dart';
import 'sentry_setup.dart';
import 'telemetry.dart';
import 'ui/dashboard.dart';
import 'ui/tray_setup.dart';
import 'worker/worker_engine.dart';

/// Magic Bracket Worker entry point.
///
/// On launch:
///   1. Initialize Firebase (cloud_firestore listener target)
///   2. Load persistent worker config (workerId, capacity, paths)
///   3. Show the dashboard window as a normal app
///   4. Set up the tray icon as a secondary affordance
///   5. Start the worker engine (Firestore listener + lease + sim runner)
///
/// Hybrid window/tray model: the app launches with a visible window.
/// Closing the window is intercepted — `windowManager.setPreventClose(true)`
/// keeps the engine alive:
///   - macOS: `MacActivationPolicyBridge.setAccessory()` drops the Dock
///     icon and menu bar. A tray click promotes back to `.regular`.
///   - Windows: `windowManager.hide()` hides the window. The tray icon
///     is the only remaining affordance.
/// The only way to fully quit is the tray icon's right-click → "Quit"
/// menu item, which stops the engine and destroys the window.
Future<void> main() async {
  await _initFileLogger();
  _log('main() started');

  // Crash reporting. The DSN is empty by default — local `flutter run`
  // builds don't pass --dart-define=SENTRY_DSN=... so the SDK runs in
  // no-op mode. Release builds wire the DSN through Doppler in
  // .github/workflows/release-worker.yml. Sentry's `appRunner` installs
  // its own FlutterError.onError / PlatformDispatcher.onError / zone
  // guard, replacing the manual hooks we used to set here.
  const dsn = String.fromEnvironment('SENTRY_DSN', defaultValue: '');
  const release = String.fromEnvironment(
    'SENTRY_RELEASE',
    defaultValue: 'worker_flutter@dev',
  );
  const gitSha = String.fromEnvironment('GIT_SHA', defaultValue: 'local');

  await SentryFlutter.init((options) {
    configureSentryOptions(options, dsn: dsn, release: release, gitSha: gitSha);
    // Tee Sentry-captured events into the local file log so a user
    // grabbing ~/Library/Logs/... still sees them. Wrap the existing
    // PII scrubber so both run.
    final upstream = options.beforeSend;
    options.beforeSend = (event, hint) {
      final summary =
          event.message?.formatted ??
          event.throwable?.toString() ??
          event.exceptions?.firstOrNull?.value ??
          '(no detail)';
      _log('Sentry capture: $summary');
      return upstream != null ? upstream(event, hint) : event;
    };
  }, appRunner: _appMain);
}

Future<void> _appMain() async {
  Telemetry.breadcrumb(TelemetryCategory.boot, 'appMain started');

  // Detect placeholder firebase_options.dart values BEFORE calling
  // initializeApp — the native FirebaseCore plugin throws an uncaught
  // NSException on bad credentials that bypasses Dart try/catch.
  String? firebaseInitError;
  final fbOpts = DefaultFirebaseOptions.currentPlatform;
  if (fbOpts.apiKey.startsWith('STUB_') || fbOpts.appId.startsWith('STUB_')) {
    firebaseInitError =
        'firebase_options.dart still has STUB values. Run `flutterfire configure` to populate.';
  } else {
    _log('Initializing Firebase for project ${fbOpts.projectId}');
    try {
      await Firebase.initializeApp(options: fbOpts);
      _log('Firebase ready');
      await _activateAppCheck();
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
  }

  // Native window setup. The app launches as `.regular` (default in
  // Info.plist) so the user sees a Dock icon + menu bar + window
  // immediately. The close button is intercepted on macOS — see
  // _WorkerAppState.onWindowClose, which hides the window AND demotes
  // the app to `.accessory` so the Dock icon disappears while the
  // worker keeps running behind the tray icon.
  _log('Initializing window_manager');
  await windowManager.ensureInitialized();
  _log('window_manager initialized');
  const opts = WindowOptions(
    size: Size(640, 520),
    minimumSize: Size(420, 360),
    center: true,
    titleBarStyle: TitleBarStyle.normal,
    title: 'Magic Bracket Worker',
  );
  await windowManager.waitUntilReadyToShow(opts, () async {
    _log('waitUntilReadyToShow callback');
    await windowManager.show();
    await windowManager.focus();
    // Intercept close on macOS and Windows — the tray icon is the
    // user's way back to the window. Pressing X hides the window
    // rather than quitting so the worker engine keeps running.
    // The only way to fully quit is the tray icon's "Quit" menu item.
    if (Platform.isMacOS || Platform.isWindows) {
      await windowManager.setPreventClose(true);
    }
  });
  _log('window ready, shown');

  // Self-update: ask Sparkle (via auto_updater) to check the appcast in
  // the repo. New `worker-v*` tags add an entry there; users running the
  // old build see the update offer on next launch and again every hour
  // while running. Non-fatal on failure (e.g. offline / appcast 404).
  await _initAutoUpdater();

  // Launch-at-login: pre-resolve the package metadata so the
  // Dashboard toggle's first read is a no-op rather than a multi-
  // hundred-ms wait while package_info_plus inspects the binary.
  // Non-fatal; toggle UI surfaces its own errors if setup couldn't.
  await AutoStartService.setup();

  // Persistent worker identity + paths.
  final config = await WorkerConfig.loadOrInit();
  _log(
    'Config loaded: workerId=${config.workerId}, capacity=${config.maxCapacity}',
  );

  if (firebaseInitError != null) {
    // Show a window-only mode with a clear setup message; no engine, no tray.
    await windowManager.show();
    runApp(_SetupRequiredApp(error: firebaseInitError, config: config));
    return;
  }

  // First-launch installer: downloads the JRE and Forge into the app's
  // support directory if they aren't already there. After this we re-load
  // the config so config.javaPath/forgePath pick up the new bundled paths.
  final installer = Installer();
  installer.progressStream.listen((p) {
    _log(
      'installer ${p.stage}: ${p.message} (${(p.progress * 100).toStringAsFixed(1)}%)',
    );
  });
  final ready = await installer.isReady();
  _log('Installer ready=$ready, jreBin=${await installer.javaBinary()}');
  if (!ready) {
    _log('Showing installer UI');
    await windowManager.show();
    runApp(
      InstallProgressApp(
        installer: installer,
        onComplete: () async {
          _log('Install complete; routing to mode');
          // Re-resolve config (java/forge paths) now that the install is done.
          final newConfig = await WorkerConfig.loadOrInit();
          await _routeToMode(newConfig);
        },
      ),
    );
    return;
  }

  _log('Already installed; routing to mode');
  await _routeToMode(config);
}

/// Dispatch into cloud or offline mode based on the user's remembered
/// choice. If nothing is remembered, show the mode picker first.
Future<void> _routeToMode(WorkerConfig config) async {
  final remembered = await readRememberedLaunchMode();
  if (remembered != null) {
    _log('Routing to remembered mode: ${remembered.prefsValue}');
    await _bootMode(config, remembered);
    return;
  }
  _log('No remembered mode; showing picker');
  await windowManager.show();
  runApp(
    MaterialApp(
      title: 'Magic Bracket',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF1F2937),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF60A5FA),
          surface: Color(0xFF111827),
        ),
      ),
      home: ModePickerScreen(
        onChosen: (mode) async {
          _log('User picked mode: ${mode.prefsValue}');
          await _bootMode(config, mode);
        },
      ),
    ),
  );
}

Future<void> _bootMode(WorkerConfig config, LaunchMode mode) async {
  switch (mode) {
    case LaunchMode.cloud:
      await _bootEngine(config);
    case LaunchMode.offline:
      await _bootOffline(config);
  }
}

Future<void> _bootOffline(WorkerConfig config) async {
  _log('Boot offline: launching local-only deck picker + sim runner');
  await windowManager.show();
  runApp(
    OfflineApp(
      config: config,
      onSwitchMode: () async {
        // Clear the remembered choice (already done by the button) and
        // re-route. The picker will show again.
        await _routeToMode(config);
      },
    ),
  );
}

Future<void> _bootEngine(WorkerConfig config) async {
  // Auth is performed lazily through the AuthGate UI rather than at
  // boot. Deferring `FirebaseAuth.instance` access until after
  // `runApp` returns keeps the historical firebase_auth_macos boot
  // crash off the cold-launch path (uncaught NSExceptions there
  // bypass Dart try/catch). The gate runs inside Flutter's normal
  // event loop, so a plugin throw lands as a Dart exception we can
  // surface in the UI instead of taking the whole process down.
  _log('Boot: deferring auth to AuthGate');

  _log('Boot: constructing WorkerEngine');
  final engine = WorkerEngine(
    config: config,
    firestore: FirebaseFirestore.instance,
  );

  // Tray init: the historical crash was specific to `LSUIElement=true`
  // combined with sandbox-disabled entitlements. With LSUIElement=false
  // (current MVP setting) the crash condition isn't met. Wrap in try/catch
  // anyway — tray failure must not kill the app since the visible window
  // is the primary affordance.
  try {
    final tray = TraySetup(engine: engine);
    await tray.init();
    _log('Boot: tray initialized');
  } catch (e, st) {
    _log('Boot: tray init failed (non-fatal): $e\n$st');
    Telemetry.breadcrumb(
      TelemetryCategory.tray,
      'Tray init failed',
      data: {'error': e.toString()},
    );
  }

  // Run the UI immediately. Start the engine *after* sign-in so
  // Firestore writes carry `request.auth.uid` — the security rules can
  // then drop the unauthenticated-write branches that exist for the
  // pre-auth MVP.
  _log('Boot: runApp');
  runApp(_WorkerApp(engine: engine, config: config));
  _log('Boot: runApp returned');
}

/// Start the engine. Called by `_WorkerApp` once auth completes (or
/// immediately if the AuthGate is bypassed). Wrapped to keep a
/// Firestore plugin crash (native NSException) from killing the UI
/// before the dashboard has a chance to render.
Future<void> _startEngineSafe(WorkerEngine engine) async {
  _log('Boot: scheduling engine.start() in background');
  try {
    await engine.start();
    _log('Boot: engine running');
  } catch (e, st) {
    _log('Engine start FAILED (caught): $e\n$st');
    await Telemetry.captureError(
      e,
      st,
      category: TelemetryCategory.engineStart,
    );
  }
}

// ── Simple file logger ────────────────────────────────────────────
// Tray-only apps have no stderr console visible to the user; we write
// to ~/Library/Logs/ which is the standard macOS user log location.
File? _logFile;

/// Appcast URL — RSS feed Sparkle polls to discover new releases. Pinned
/// to `main` so a tag push that updates the appcast hits existing
/// installs without any extra deploy step.
const _kAppcastUrl =
    'https://raw.githubusercontent.com/TytaniumDev/MagicBracketSimulator/main/worker_flutter/appcast.xml';

/// Check on launch + every hour while the app is open. Sparkle will
/// surface a "new version available" dialog itself; we don't render UI.
const _kAutoUpdateCheckIntervalSeconds = 3600;

/// Channel paired with the "Check for Updates…" NSMenuItem installed
/// by `MainFlutterWindow.swift`. The Swift side fires "checkForUpdates"
/// when the user clicks the menu item; we forward to
/// `autoUpdater.checkForUpdates(inBackground: false)` so Sparkle shows
/// its UI even when there's no update available — the interactive
/// "You're up to date" alert is the expected affordance when the user
/// explicitly asks. The background poll set up below keeps using
/// `inBackground: true` to stay silent on the no-update path.
const _kAutoUpdaterChannel = MethodChannel('magic_bracket/auto_updater');

/// Initialize Firebase App Check so API calls carry an
/// `X-Firebase-AppCheck` token alongside the Firebase ID token —
/// without it the cloud API returns 401 "Auth token rejected" on every
/// request that goes through `verifyAllowedUser`/`verifyAuth`.
///
/// macOS uses Apple's App Attest in release builds and a debug provider
/// in `flutter run` so a locally-running app can be paired with the
/// debug token surfaced via Firebase Console → App Check → Apps.
/// Windows is a no-op: `firebase_app_check` has no Windows desktop
/// support yet, so the Windows worker relies on the "Run locally"
/// path (which bypasses the API entirely) for end-user workflows.
Future<void> _activateAppCheck() async {
  if (!Platform.isMacOS) {
    _log('AppCheck: skipping (unsupported platform)');
    return;
  }
  try {
    await FirebaseAppCheck.instance.activate(
      appleProvider: kDebugMode ? AppleProvider.debug : AppleProvider.appAttest,
    );
    _log('AppCheck: activated (${kDebugMode ? "debug" : "appAttest"})');
  } catch (e, st) {
    // Non-fatal: leaves API calls unauthenticated against App Check,
    // which the user will see as "Auth token rejected". Capturing the
    // failure lets us see why before the user-facing error surfaces.
    _log('AppCheck: activation failed (non-fatal): $e\n$st');
    await Telemetry.captureError(
      e,
      st,
      category: TelemetryCategory.firebaseInit,
      extra: {'step': 'appCheckActivate'},
    );
  }
}

Future<void> _initAutoUpdater() async {
  // Register the menu-item channel handler FIRST — before any await
  // that could throw and skip the rest of the setup. If `setFeedURL`
  // or `setScheduledCheckInterval` fails, Sparkle's appcast polling
  // is disabled, but the menu item should still respond (with the
  // failure surfaced in the log) instead of clicking into the void.
  _kAutoUpdaterChannel.setMethodCallHandler((call) async {
    if (call.method != 'checkForUpdates') {
      // Unknown method on a channel we control both ends of — bubble
      // a real error so a wiring mistake surfaces during development
      // rather than getting silently swallowed.
      throw MissingPluginException(
        'magic_bracket/auto_updater: unknown method "${call.method}"',
      );
    }
    _log('AutoUpdater: user-initiated check from menu');
    try {
      await autoUpdater.checkForUpdates(inBackground: false);
    } catch (e, st) {
      _log('AutoUpdater: user-initiated check failed: $e\n$st');
    }
  });
  try {
    await autoUpdater.setFeedURL(_kAppcastUrl);
    await autoUpdater.setScheduledCheckInterval(
      _kAutoUpdateCheckIntervalSeconds,
    );
    // Background check so the user doesn't see a "no update available" toast
    // when nothing is new.
    await autoUpdater.checkForUpdates(inBackground: true);
    _log(
      'AutoUpdater: feed=$_kAppcastUrl, interval=${_kAutoUpdateCheckIntervalSeconds}s',
    );
  } catch (e, st) {
    // Sparkle init failure (e.g. missing SUPublicEDKey in some configs) is
    // not fatal — the worker still runs, just without self-update. Log
    // so we notice in the diagnostic file.
    _log('AutoUpdater init failed (non-fatal): $e\n$st');
    Telemetry.breadcrumb(
      TelemetryCategory.autoUpdater,
      'AutoUpdater init failed',
      data: {'error': e.toString()},
    );
  }
}

Future<void> _initFileLogger() async {
  // Per-platform convention: macOS uses ~/Library/Logs; Windows uses
  // %LocalAppData%\com.tytaniumdev.magicBracketSimulator\Logs.
  late final Directory logsDir;
  if (Platform.isWindows) {
    final localAppData =
        Platform.environment['LOCALAPPDATA'] ??
        '${Platform.environment['USERPROFILE'] ?? ''}\\AppData\\Local';
    logsDir = Directory(
      '$localAppData\\com.tytaniumdev.magicBracketSimulator\\Logs',
    );
  } else {
    final home = Platform.environment['HOME'] ?? '';
    logsDir = Directory('$home/Library/Logs');
  }
  if (!logsDir.existsSync()) logsDir.createSync(recursive: true);
  _logFile = File(
    '${logsDir.path}${Platform.pathSeparator}com.tytaniumdev.magicBracketSimulator.log',
  );
  _logFile!.writeAsStringSync(
    '\n=== ${DateTime.now().toIso8601String()} app launched ===\n',
    mode: FileMode.append,
  );
}

void _log(String msg) {
  final line = '${DateTime.now().toIso8601String()} $msg\n';
  if (kDebugMode) debugPrint(line);
  try {
    _logFile?.writeAsStringSync(line, mode: FileMode.append);
  } catch (_) {
    /* ignore */
  }
}

/// Shown when Firebase failed to initialize (typically the first run before
/// `flutterfire configure` has populated firebase_options.dart). Gives the
/// user a clear path forward instead of a stack trace.
class _SetupRequiredApp extends StatelessWidget {
  const _SetupRequiredApp({required this.error, required this.config});

  final String error;
  final WorkerConfig config;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Magic Bracket Worker — Setup Required',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(),
      home: Scaffold(
        backgroundColor: const Color(0xFF1F2937),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text(
                'Setup required',
                style: TextStyle(
                  fontSize: 22,
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'The worker app needs Firebase credentials before it can '
                'connect to the simulation queue.',
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 16),
              const Text(
                'Run this in the worker_flutter directory:',
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF111827),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const SelectableText(
                  'dart pub global activate flutterfire_cli\n'
                  'flutterfire configure --project=<your-project-id>\n'
                  'flutter run -d macos',
                  style: TextStyle(
                    color: Colors.greenAccent,
                    fontFamily: 'Menlo',
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Worker ID: ${config.workerId}',
                style: const TextStyle(color: Colors.white38, fontSize: 11),
              ),
              const SizedBox(height: 8),
              Text(
                'Firebase error: $error',
                style: const TextStyle(color: Colors.redAccent, fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WorkerApp extends StatefulWidget {
  const _WorkerApp({required this.engine, required this.config});

  final WorkerEngine engine;
  final WorkerConfig config;

  @override
  State<_WorkerApp> createState() => _WorkerAppState();
}

class _WorkerAppState extends State<_WorkerApp> with WindowListener {
  final AuthService _auth = AuthService();
  AuthedUser? _user;
  bool _engineStarted = false;
  bool _restoringSession = true;

  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    _performSilentSignIn();
  }

  Future<void> _performSilentSignIn() async {
    try {
      final user = await _auth.trySilentSignIn();
      if (mounted) {
        setState(() {
          _user = user;
          _restoringSession = false;
        });
        if (user != null) {
          await _onAuthed(user);
        }
      }
    } catch (e, st) {
      _log('Silent sign-in threw error: $e\n$st');
      if (mounted) {
        setState(() {
          _user = null;
          _restoringSession = false;
        });
      }
    }
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    super.dispose();
  }

  @override
  void onWindowClose() async {
    // Both macOS and Windows get the hide-to-tray treatment (see
    // _appMain's setPreventClose). Pressing X hides the window while
    // the worker engine keeps running. The tray icon is the user's
    // way back; right-click → Quit is the only way to fully exit.
    //
    // The listener has a `void` return type, so a throw here would
    // be silently dropped by the framework. Wrap the whole body in
    // try/catch so a bridge failure (PlatformException) is at least
    // visible in the log file.
    try {
      if (Platform.isMacOS) {
        _log('onWindowClose: hiding window, demoting to accessory');
        // Hide the window first, then demote to `.accessory` so the
        // Dock icon and menu bar disappear in a single visual beat.
        // Tray icon stays around as the way back. Engine keeps running
        // — the activation policy only affects UI affordances.
        await windowManager.hide();
        await MacActivationPolicyBridge.setAccessory();
      } else if (Platform.isWindows) {
        _log('onWindowClose: hiding window to tray (Windows)');
        // On Windows there's no activation-policy equivalent; just
        // hide the window. The tray icon remains as the sole
        // affordance. The taskbar entry disappears when hidden.
        await windowManager.hide();
      } else {
        _log('onWindowClose: destroying window (Linux quit-on-close)');
        await windowManager.destroy();
      }
    } catch (e, st) {
      _log('onWindowClose: transition failed: $e\n$st');
    }
  }

  Future<void> _onAuthed(AuthedUser user) async {
    setState(() => _user = user);
    if (_engineStarted) return;
    _engineStarted = true;
    await _startEngineSafe(widget.engine);
  }

  Future<void> _switchToOffline() async {
    // Clear the remembered cloud choice so next launch reshows the
    // mode picker, then signal the existing route-to-mode helper.
    await clearRememberedLaunchMode();
    await _routeToMode(widget.config);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Magic Bracket Worker',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF1F2937),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF60A5FA),
          surface: Color(0xFF111827),
        ),
      ),
      home: _restoringSession
          ? const Scaffold(
              body: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 16),
                    Text(
                      'Restoring session…',
                      style: TextStyle(color: Colors.white70, fontSize: 14),
                    ),
                  ],
                ),
              ),
            )
          : (_user == null
              ? AuthGateScreen(
                  authService: _auth,
                  onAuthed: _onAuthed,
                  onSwitchToOffline: _switchToOffline,
                )
              : Dashboard(engine: widget.engine, config: widget.config)),
    );
  }
}
