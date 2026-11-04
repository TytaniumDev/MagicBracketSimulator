import 'dart:io';

import 'macos_sleep_guard.dart';
import 'windows_sleep_guard.dart';

/// Asks the OS not to idle-sleep the computer, the way `caffeinate` does on
/// a Mac. The display can still turn off, and a closed laptop lid still
/// sleeps the computer. [SleepGuard.forPlatform] picks the implementation
/// for this OS.
///
/// [hold] and [release] are idempotent, and throw when the OS call fails so
/// callers can report it.
abstract class SleepGuard {
  /// The implementation for the OS this app runs on.
  factory SleepGuard.forPlatform() {
    if (Platform.isMacOS) return MacSleepGuard();
    if (Platform.isWindows) return WindowsSleepGuard();
    return const _UnsupportedSleepGuard();
  }

  /// Keep the computer awake until [release].
  Future<void> hold();

  /// Let the computer idle-sleep again.
  Future<void> release();
}

class _UnsupportedSleepGuard implements SleepGuard {
  const _UnsupportedSleepGuard();

  @override
  Future<void> hold() async {}

  @override
  Future<void> release() async {}
}
