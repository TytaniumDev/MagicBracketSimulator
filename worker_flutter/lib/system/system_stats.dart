import 'dart:io';

import 'macos_system_stats.dart';
import 'windows_system_stats.dart';

/// One reading of how busy this machine is.
class SystemLoad {
  const SystemLoad({required this.cpuBusy, required this.availableMemoryMb});

  /// Share of all cores in use, from 0.0 (idle) to 1.0 (every core busy).
  final double cpuBusy;

  /// Physical RAM the OS can hand out right now without paging, in MB.
  final int availableMemoryMb;
}

/// Reads this machine's RAM and load. Dart has no API for either, so each
/// OS gets its own implementation; [SystemStats.forPlatform] picks one.
///
/// Reads return null when this OS has no implementation, and throw when
/// the OS call fails, so callers can report the failure.
abstract class SystemStats {
  /// The implementation for the OS this app runs on.
  factory SystemStats.forPlatform() {
    if (Platform.isWindows) return WindowsSystemStats();
    if (Platform.isMacOS) return MacSystemStats();
    return const _UnsupportedSystemStats();
  }

  /// Total physical RAM in MB.
  Future<int?> totalMemoryMb();

  /// The current load. CPU is measured between calls on some OSes, so the
  /// first call there returns null.
  Future<SystemLoad?> sample();
}

class _UnsupportedSystemStats implements SystemStats {
  const _UnsupportedSystemStats();

  @override
  Future<int?> totalMemoryMb() async => null;

  @override
  Future<SystemLoad?> sample() async => null;
}
