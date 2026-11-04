import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'system/system_stats.dart';
import 'telemetry.dart';
import 'worker/sim_capacity.dart';

/// Persistent worker configuration: identity, capacity, paths.
///
/// `workerId` is generated once on first launch and persisted. It is the
/// stable Firestore doc ID for this machine across restarts.
class WorkerConfig {
  WorkerConfig({
    required this.workerId,
    required this.workerName,
    required this.maxCapacity,
    required this.forgePath,
    required this.javaPath,
    required this.decksPath,
    required this.logsPath,
    required this.apiUrl,
    this.capacityLimit = SimCapacity.fallbackLimit,
    this.autoCapacity = false,
    this.keepAwake = false,
  });

  final String workerId;
  final String workerName;

  /// Upper bound on concurrent sims. Mutable so a change from the UI takes
  /// effect on the running engine without an app restart. In Auto mode it
  /// is where the adaptive target starts.
  int maxCapacity;

  /// Auto mode: the engine adapts the number of sims to live CPU and free
  /// RAM (up to [capacityLimit]) instead of holding at [maxCapacity].
  bool autoCapacity;

  /// Keep the computer awake the whole time the engine runs. Off, the
  /// engine keeps it awake only while sims run, and takes no new sims once
  /// the computer is due to sleep (`SleepCoordinator`).
  bool keepAwake;

  /// The most parallel sims this machine's cores and RAM can carry
  /// ([SimCapacity.limitFor]). Detected at launch, never persisted; the
  /// Max parallel sims slider stops here.
  final int capacityLimit;
  final String
  forgePath; // Path to extracted Forge install dir (contains forge-gui-desktop-*.jar)
  final String javaPath; // Absolute path to `java` binary
  final String
  decksPath; // ~/Library/Application Support/Forge/decks/commander on macOS
  final String logsPath; // worker-local logs dir
  final String apiUrl; // Base URL of the cloud API (for log upload)

  static const _kWorkerId = 'worker.id';
  static const _kWorkerName = 'worker.name';
  static const _kCapacity = 'worker.capacity';
  static const _kAutoCapacity = 'worker.capacityAuto';
  static const _kKeepAwake = 'worker.keepAwake';
  static const _kForgePath = 'worker.forgePath';
  static const _kJavaPath = 'worker.javaPath';
  static const _kApiUrl = 'worker.apiUrl';
  static const _defaultApiUrl =
      'https://api--magic-bracket-simulator.us-central1.hosted.app';

  /// Loads the saved config. A machine that never chose a capacity starts
  /// at its hardware limit; a saved capacity above the limit is lowered
  /// to it (say, after moving the settings to a smaller machine).
  static Future<WorkerConfig> loadOrInit() async {
    final prefs = await SharedPreferences.getInstance();
    final capacityLimit = SimCapacity.limitFor(
      logicalCores: Platform.numberOfProcessors,
      totalMemoryMb: await _readTotalMemoryMb(),
    );

    var workerId = prefs.getString(_kWorkerId);
    if (workerId == null || workerId.isEmpty) {
      workerId = const Uuid().v4();
      await prefs.setString(_kWorkerId, workerId);
    }

    var workerName = prefs.getString(_kWorkerName);
    if (workerName == null || workerName.isEmpty) {
      workerName = await _defaultWorkerName();
      await prefs.setString(_kWorkerName, workerName);
    }

    final capacity = (prefs.getInt(_kCapacity) ?? capacityLimit).clamp(
      1,
      capacityLimit,
    );
    final forgePath = prefs.getString(_kForgePath) ?? await _defaultForgePath();
    final javaPath = prefs.getString(_kJavaPath) ?? await _defaultJavaPath();
    final decksPath = await _forgeDecksDir();
    final logsPath = await _logsDir();
    final apiUrl = prefs.getString(_kApiUrl) ?? _defaultApiUrl;

    return WorkerConfig(
      workerId: workerId,
      workerName: workerName,
      maxCapacity: capacity,
      forgePath: forgePath,
      javaPath: javaPath,
      decksPath: decksPath,
      logsPath: logsPath,
      apiUrl: apiUrl,
      capacityLimit: capacityLimit,
      autoCapacity: prefs.getBool(_kAutoCapacity) ?? false,
      keepAwake: prefs.getBool(_kKeepAwake) ?? false,
    );
  }

  /// Physical RAM in MB, or null when it can't be read (reported to
  /// Sentry), which limits capacity by cores alone.
  static Future<int?> _readTotalMemoryMb() async {
    try {
      return await SystemStats.forPlatform().totalMemoryMb();
    } catch (e, st) {
      debugPrint('Reading total RAM failed: $e\n$st');
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.boot,
        extra: {'phase': 'read_total_memory'},
      );
      return null;
    }
  }

  Future<void> setApiUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kApiUrl, url);
  }

  Future<void> setCapacity(int n) async {
    maxCapacity = n;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_kCapacity, n);
  }

  Future<void> setAutoCapacity(bool on) async {
    autoCapacity = on;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kAutoCapacity, on);
  }

  Future<void> setKeepAwake(bool on) async {
    keepAwake = on;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kKeepAwake, on);
  }

  Future<void> setForgePath(String path) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kForgePath, path);
  }

  Future<void> setJavaPath(String path) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kJavaPath, path);
  }

  static Future<String> _defaultWorkerName() async {
    try {
      final result = await Process.run('scutil', ['--get', 'ComputerName']);
      final name = (result.stdout as String).trim();
      if (name.isNotEmpty) return name;
    } catch (_) {
      /* fall through */
    }
    return Platform.localHostname;
  }

  static Future<String> _defaultForgePath() async {
    // Bundled location managed by the first-run Installer.
    final supportDir = await getApplicationSupportDirectory();
    return '${supportDir.path}/forge';
  }

  static Future<String> _defaultJavaPath() async {
    // First try the bundled JRE installed by the first-run Installer.
    final supportDir = await getApplicationSupportDirectory();
    final bundledJre = Platform.isWindows
        ? '${supportDir.path}\\jre\\bin\\java.exe'
        : '${supportDir.path}/jre/Contents/Home/bin/java';
    if (File(bundledJre).existsSync()) return bundledJre;

    // Fall back to a system Java if the user installed one themselves.
    final candidates = Platform.isWindows
        ? const <String>[
            r'C:\Program Files\Eclipse Adoptium\jre-17\bin\java.exe',
            r'C:\Program Files\Java\jre-17\bin\java.exe',
          ]
        : const <String>[
            '/opt/homebrew/opt/openjdk@17/bin/java',
            '/usr/local/opt/openjdk@17/bin/java',
            '/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home/bin/java',
          ];
    for (final c in candidates) {
      if (File(c).existsSync()) return c;
    }
    return Platform.isWindows ? 'java.exe' : 'java';
  }

  static Future<String> _forgeDecksDir() async {
    if (Platform.isWindows) {
      // Forge defaults to %AppData%\Forge on Windows.
      final appData =
          Platform.environment['APPDATA'] ??
          '${Platform.environment['USERPROFILE'] ?? ''}\\AppData\\Roaming';
      return '$appData\\Forge\\decks\\commander';
    }
    final home = Platform.environment['HOME'] ?? '';
    return '$home/Library/Application Support/Forge/decks/commander';
  }

  static Future<String> _logsDir() async {
    final supportDir = await getApplicationSupportDirectory();
    final logs = Directory('${supportDir.path}/sim-logs');
    if (!logs.existsSync()) logs.createSync(recursive: true);
    return logs.path;
  }
}
