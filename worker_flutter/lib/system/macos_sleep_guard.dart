import 'dart:async';
import 'dart:io';

import 'sleep_guard.dart';

/// [SleepGuard] for macOS: runs `caffeinate -i -w <our pid>` while held.
///
/// `-i` stops idle system sleep. `-w` makes caffeinate exit on its own when
/// this app exits, so a crash can't leave the Mac stuck awake.
class MacSleepGuard implements SleepGuard {
  Process? _caffeinate;

  @override
  Future<void> hold() async {
    if (_caffeinate != null) return;
    final process = await Process.start('/usr/bin/caffeinate', [
      '-i',
      '-w',
      '$pid',
    ]);
    _caffeinate = process;
    // If caffeinate dies on its own, forget it so the next hold starts a
    // new one.
    unawaited(
      process.exitCode.then((_) {
        if (identical(_caffeinate, process)) _caffeinate = null;
      }),
    );
  }

  @override
  Future<void> release() async {
    final process = _caffeinate;
    _caffeinate = null;
    process?.kill();
  }
}
