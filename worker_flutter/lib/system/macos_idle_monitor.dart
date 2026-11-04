import 'dart:io';

import 'package:flutter/foundation.dart';

import 'idle_monitor.dart';

/// [IdleMonitor] for macOS, read from `ioreg` (user idle time) and `pmset`
/// (the sleep timer). Both return at once.
class MacIdleMonitor implements IdleMonitor {
  @override
  Future<Duration?> userIdle() async => parseHidIdleTime(
    await _run('ioreg', ['-r', '-c', 'IOHIDSystem', '-d', '1']),
  );

  @override
  Future<Duration?> sleepAfter() async =>
      parsePmsetSleep(await _run('pmset', ['-g']));

  static Future<String> _run(String command, List<String> args) async {
    final result = await Process.run(command, args);
    if (result.exitCode != 0) {
      throw ProcessException(
        command,
        args,
        '${result.stderr}',
        result.exitCode,
      );
    }
    return '${result.stdout}';
  }

  /// Time since the last input, from the `"HIDIdleTime" = <nanoseconds>`
  /// property `ioreg` prints for IOHIDSystem.
  @visibleForTesting
  static Duration parseHidIdleTime(String output) {
    final match = RegExp(r'"HIDIdleTime" = (\d+)').firstMatch(output);
    if (match == null) {
      throw FormatException('ioreg output has no HIDIdleTime', output);
    }
    return Duration(microseconds: int.parse(match.group(1)!) ~/ 1000);
  }

  /// The idle sleep timer from `pmset -g`, which lists the settings in use
  /// for the current power source. Its `sleep` line holds minutes, 0 for
  /// never, and may carry a note such as "(sleep prevented by caffeinate)".
  @visibleForTesting
  static Duration parsePmsetSleep(String output) {
    final match = RegExp(
      r'^\s*sleep\s+(\d+)',
      multiLine: true,
    ).firstMatch(output);
    if (match == null) {
      throw FormatException('pmset -g output has no sleep setting', output);
    }
    return Duration(minutes: int.parse(match.group(1)!));
  }
}
