import 'dart:io';

import 'macos_idle_monitor.dart';
import 'windows_idle_monitor.dart';

/// Reads what the OS needs to decide on idle sleep: how long the user has
/// been away, and how long the OS waits before sleeping.
/// [IdleMonitor.forPlatform] picks the implementation for this OS.
///
/// Reads return null when this OS has no implementation, and throw when
/// the OS call fails, so callers can report the failure.
abstract class IdleMonitor {
  /// The implementation for the OS this app runs on.
  factory IdleMonitor.forPlatform() {
    if (Platform.isMacOS) return MacIdleMonitor();
    if (Platform.isWindows) return WindowsIdleMonitor();
    return const _UnsupportedIdleMonitor();
  }

  /// Time since the last keyboard, mouse or trackpad input.
  Future<Duration?> userIdle();

  /// How long the computer may sit idle before the OS sleeps it, for the
  /// power source in use now (plugged in or battery). [Duration.zero] when
  /// the OS is set to never sleep.
  Future<Duration?> sleepAfter();
}

class _UnsupportedIdleMonitor implements IdleMonitor {
  const _UnsupportedIdleMonitor();

  @override
  Future<Duration?> userIdle() async => null;

  @override
  Future<Duration?> sleepAfter() async => null;
}
