import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

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
  });

  final String workerId;
  final String workerName;
  final int maxCapacity;
  final String forgePath;   // Path to extracted Forge install dir (contains forge-gui-desktop-*.jar)
  final String javaPath;    // Absolute path to `java` binary
  final String decksPath;   // ~/Library/Application Support/Forge/decks/commander on macOS
  final String logsPath;    // worker-local logs dir

  static const _kWorkerId = 'worker.id';
  static const _kWorkerName = 'worker.name';
  static const _kCapacity = 'worker.capacity';
  static const _kForgePath = 'worker.forgePath';
  static const _kJavaPath = 'worker.javaPath';

  static Future<WorkerConfig> loadOrInit({int defaultCapacity = 2}) async {
    final prefs = await SharedPreferences.getInstance();

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

    final capacity = prefs.getInt(_kCapacity) ?? defaultCapacity;
    final forgePath = prefs.getString(_kForgePath) ?? await _defaultForgePath();
    final javaPath = prefs.getString(_kJavaPath) ?? await _defaultJavaPath();
    final decksPath = await _forgeDecksDir();
    final logsPath = await _logsDir();

    return WorkerConfig(
      workerId: workerId,
      workerName: workerName,
      maxCapacity: capacity,
      forgePath: forgePath,
      javaPath: javaPath,
      decksPath: decksPath,
      logsPath: logsPath,
    );
  }

  Future<void> setCapacity(int n) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_kCapacity, n);
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
    } catch (_) {/* fall through */}
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
    final bundledJre = '${supportDir.path}/jre/Contents/Home/bin/java';
    if (File(bundledJre).existsSync()) return bundledJre;

    // Fall back to system Java if the user installed one themselves
    // (e.g. running from CLI before first-launch download completes).
    const candidates = [
      '/opt/homebrew/opt/openjdk@17/bin/java',
      '/usr/local/opt/openjdk@17/bin/java',
      '/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home/bin/java',
    ];
    for (final c in candidates) {
      if (File(c).existsSync()) return c;
    }
    return 'java';
  }

  static Future<String> _forgeDecksDir() async {
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
