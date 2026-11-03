import 'dart:io';

import 'package:flutter/foundation.dart';

import '../telemetry.dart';

/// Reads this machine's physical RAM. Dart has no API for it, so this asks
/// the OS: `sysctl` on macOS, PowerShell (CIM) on Windows.
class SystemMemory {
  SystemMemory._();

  static Future<int?>? _totalMb;

  /// Total physical RAM in MB, or null when it can't be read (unsupported
  /// OS, or the command failed). Failures are reported to Sentry. Read once
  /// per launch: PowerShell takes about a second to start.
  static Future<int?> totalMb() => _totalMb ??= _readTotalMb();

  static Future<int?> _readTotalMb() async {
    final List<String> command;
    if (Platform.isMacOS) {
      command = ['sysctl', '-n', 'hw.memsize'];
    } else if (Platform.isWindows) {
      command = [
        'powershell',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory',
      ];
    } else {
      return null;
    }
    try {
      final result = await Process.run(command.first, command.sublist(1));
      final mb = parseBytesAsMb('${result.stdout}');
      if (result.exitCode != 0 || mb == null) {
        throw StateError(
          'Reading total RAM failed: exit ${result.exitCode}, '
          'stdout "${result.stdout}", stderr "${result.stderr}"',
        );
      }
      return mb;
    } catch (e, st) {
      debugPrint('SystemMemory.totalMb failed: $e\n$st');
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.boot,
        tags: {'step': 'read_total_memory'},
      );
      return null;
    }
  }

  /// Parses a byte count printed on its own line (what both `sysctl -n` and
  /// the PowerShell command print) into whole MB. Null if it isn't one.
  @visibleForTesting
  static int? parseBytesAsMb(String output) {
    final bytes = int.tryParse(output.trim());
    if (bytes == null || bytes <= 0) return null;
    return bytes ~/ (1024 * 1024);
  }
}
