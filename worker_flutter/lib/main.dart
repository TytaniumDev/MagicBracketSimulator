import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import 'config.dart';
import 'firebase_options.dart';
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
  WidgetsFlutterBinding.ensureInitialized();

  // Detect placeholder firebase_options.dart values BEFORE calling
  // initializeApp — the native FirebaseCore plugin throws an uncaught
  // NSException on bad credentials that bypasses Dart try/catch.
  String? firebaseInitError;
  final fbOpts = DefaultFirebaseOptions.currentPlatform;
  if (fbOpts.apiKey.startsWith('STUB_') || fbOpts.appId.startsWith('STUB_')) {
    firebaseInitError =
        'firebase_options.dart still has STUB values. Run `flutterfire configure` to populate.';
  } else {
    try {
      await Firebase.initializeApp(options: fbOpts);
    } catch (e) {
      firebaseInitError = e.toString();
    }
  }

  // Native window setup (start hidden so we don't flash before tray is up).
  await windowManager.ensureInitialized();
  const opts = WindowOptions(
    size: Size(560, 480),
    minimumSize: Size(420, 360),
    center: true,
    skipTaskbar: true,
    titleBarStyle: TitleBarStyle.normal,
    title: 'Magic Bracket Worker',
  );
  await windowManager.waitUntilReadyToShow(opts, () async {
    await windowManager.hide();
    await windowManager.setPreventClose(true);
  });

  // Persistent worker identity + paths.
  final config = await WorkerConfig.loadOrInit();

  if (firebaseInitError != null) {
    // Show a window-only mode with a clear setup message; no engine, no tray.
    await windowManager.show();
    runApp(_SetupRequiredApp(error: firebaseInitError, config: config));
    return;
  }

  // Engine: listens to Firestore, claims sims, runs Java, writes lease.
  final engine = WorkerEngine(
    config: config,
    firestore: FirebaseFirestore.instance,
  );

  // Tray icon: left-click shows window, right-click menu has controls.
  final tray = TraySetup(engine: engine);
  await tray.init();

  // Start the engine immediately on launch. User can stop via tray.
  await engine.start();

  runApp(_WorkerApp(engine: engine, config: config));
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
