import 'dart:io';

import 'package:flutter/foundation.dart';

import 'telemetry.dart';

/// Append-only local log file, mirrored into Sentry breadcrumbs.
///
/// Every line written here also lands as a breadcrumb, and sentry_flutter
/// syncs breadcrumbs to the native SDK. So when the process dies hard
/// (e.g. an unhandled C++ exception inside a plugin), the native crash
/// report still carries the trail of steps that led up to it.
///
/// File location follows each platform's convention:
///   - macOS: ~/Library/Logs/
///   - Windows: %LocalAppData%\com.tytaniumdev.magicBracketSimulator\Logs\
class AppLog {
  AppLog._();

  static const _fileName = 'com.tytaniumdev.magicBracketSimulator.log';

  static File? _file;

  /// Open (or create) the log file and write a launch separator. Safe to
  /// call before Sentry is initialized.
  static Future<void> init() async {
    final dir = _logsDir();
    if (!dir.existsSync()) dir.createSync(recursive: true);
    _file = File('${dir.path}${Platform.pathSeparator}$_fileName');
    _append('\n=== ${DateTime.now().toIso8601String()} app launched ===\n');
  }

  /// Log [message] to the file and record it as a breadcrumb under
  /// [category]. [data] is attached to the breadcrumb only; keep it small
  /// and free of PII (the Sentry `beforeSend` scrubber is a backstop, not
  /// a license).
  static void event(
    TelemetryCategory category,
    String message, {
    Map<String, dynamic>? data,
  }) {
    final suffix = data == null || data.isEmpty ? '' : ' $data';
    final line =
        '${DateTime.now().toIso8601String()} [${category.tagValue}] $message$suffix\n';
    if (kDebugMode) debugPrint(line);
    _append(line);
    Telemetry.breadcrumb(category, message, data: data);
  }

  static void _append(String text) {
    try {
      _file?.writeAsStringSync(text, mode: FileMode.append, flush: true);
    } catch (_) {
      // Logging must never take the app down.
    }
  }

  static Directory _logsDir() {
    if (Platform.isWindows) {
      final localAppData =
          Platform.environment['LOCALAPPDATA'] ??
          '${Platform.environment['USERPROFILE'] ?? ''}\\AppData\\Local';
      return Directory(
        '$localAppData\\com.tytaniumdev.magicBracketSimulator\\Logs',
      );
    }
    final home = Platform.environment['HOME'] ?? '';
    return Directory('$home/Library/Logs');
  }
}
