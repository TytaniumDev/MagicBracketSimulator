import 'dart:async';
import 'dart:io';

import 'package:auto_updater/auto_updater.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import 'config.dart';
import 'firebase_options.dart';
import 'installer/install_progress_app.dart';
import 'installer/installer.dart';
import 'launch/mode_picker_screen.dart';
import 'offline/offline_app.dart';
import 'ui/dashboard.dart';
import 'ui/tray_setup.dart';
import 'worker/worker_engine.dart';

/// Magic Bracket Worker entry point.
///
/// On launch:
///   1. Initialize Firebase (cloud_firestore listener target)
///   2. Load persistent worker config (workerId, capacity, paths)
///   3. Set up an invisible window (LSUIElement=true hides the Dock icon
///      already; we additionally `hide()` the window so it doesn't flash)
///   4. Set up the tray icon; left-click shows the dashboard
///   5. Start the worker engine (Firestore listener + lease + sim runner)
///
/// The window starts hidden. The user opens it from the tray. Closing the
/// window via the red dot is intercepted by window_manager.setPreventClose
/// and hides instead of exiting — the engine keeps running.
Future<void> main() async {
  await _initFileLogger();
  WidgetsFlutterBinding.ensureInitialized();
  _log('main() started');
  FlutterError.onError = (details) {
    _log('FlutterError: ${details.exception}\n${details.stack}');
    FlutterError.dumpErrorToConsole(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    _log('PlatformDispatcher onError: $error\n$stack');
    return true;
  };
  await runZonedGuarded(_appMain, (error, stack) {
    _log('UNCAUGHT (zone): $error\n$stack');
  });
}

Future<void> _appMain() async {
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
    } catch (e) {
      firebaseInitError = e.toString();
      _log('Firebase init failed: $e');
    }
  }

  // Native window setup. With LSUIElement=false (MVP fallback) the app
  // appears in the Dock with a regular window. The user can minimize-to-
  // tray-style behavior via the tray icon; closing the window hides it
  // (setPreventClose=true) so the engine keeps running.
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
    await windowManager.setPreventClose(true);
  });
  _log('window ready, shown');

  // Self-update: ask Sparkle (via auto_updater) to check the appcast in
  // the repo. New `worker-v*` tags add an entry there; users running the
  // old build see the update offer on next launch and again every hour
  // while running. Non-fatal on failure (e.g. offline / appcast 404).
  await _initAutoUpdater();

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
  _log('Boot offline: runApp placeholder');
  await windowManager.show();
  runApp(
    OfflineApp(
      onSwitchMode: () async {
        // Clear the remembered choice (already done by the button) and
        // re-route. The picker will show again.
        await _routeToMode(config);
      },
    ),
  );
}

Future<void> _bootEngine(WorkerConfig config) async {
  // Auth is intentionally NOT performed at boot. The firebase_auth_macos
  // plugin throws an uncaught NSException for several common boot
  // conditions (anonymous-auth-disabled, no GoogleService-Info.plist,
  // etc.) that bypass Dart try/catch and kill the app. Until we wire up
  // a proper Google Sign-In flow (Plan 3), Firestore writes will fail
  // with permission-denied if the project's security rules require auth,
  // but the engine itself will at least stay running and surface those
  // errors in the dashboard.
  _log('Boot: skipping Firebase Auth (deferred to Plan 3)');

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
  }

  // Run the UI immediately. Start the engine in the background so a
  // Firestore plugin crash (which can throw native NSExceptions that
  // bypass Dart try/catch) doesn't bring down the app before the user
  // sees the dashboard.
  _log('Boot: runApp');
  runApp(_WorkerApp(engine: engine, config: config));
  _log('Boot: runApp returned');

  _log('Boot: scheduling engine.start() in background');
  Future<void>(() async {
    try {
      await engine.start();
      _log('Boot: engine running');
    } catch (e, st) {
      _log('Engine start FAILED (caught): $e\n$st');
    }
  });
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

Future<void> _initAutoUpdater() async {
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
  }
}

Future<void> _initFileLogger() async {
  final home = Platform.environment['HOME'] ?? '';
  final logsDir = Directory('$home/Library/Logs');
  if (!logsDir.existsSync()) logsDir.createSync(recursive: true);
  _logFile = File('${logsDir.path}/com.tytaniumdev.magicBracketSimulator.log');
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
  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    super.dispose();
  }

  @override
  void onWindowClose() async {
    // Window close button → hide instead of quit. Engine keeps running.
    await windowManager.hide();
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
      home: Dashboard(engine: widget.engine, config: widget.config),
    );
  }
}
