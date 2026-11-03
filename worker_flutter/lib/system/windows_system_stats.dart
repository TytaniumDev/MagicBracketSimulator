import 'dart:ffi';

import 'package:ffi/ffi.dart';
import 'package:flutter/foundation.dart';

import 'system_stats.dart';

/// [SystemStats] for Windows, read straight from kernel32 through FFI:
/// `GlobalMemoryStatusEx` for RAM and `GetSystemTimes` for CPU. No process
/// is spawned, so sampling every few seconds costs nothing noticeable.
class WindowsSystemStats implements SystemStats {
  CpuTimes? _previousTimes;

  @override
  Future<int?> totalMemoryMb() async => _memoryStatus().totalMb;

  @override
  Future<SystemLoad?> sample() async {
    final times = _systemTimes();
    final previous = _previousTimes;
    _previousTimes = times;
    if (previous == null) return null;
    return SystemLoad(
      cpuBusy: cpuBusyBetween(previous, times),
      availableMemoryMb: _memoryStatus().availableMb,
    );
  }

  /// Share of CPU time spent busy between two `GetSystemTimes` readings.
  /// Windows counts idle time inside kernel time, so busy is
  /// kernel + user - idle. 0 when no time passed.
  @visibleForTesting
  static double cpuBusyBetween(CpuTimes before, CpuTimes after) {
    final idle = after.idle - before.idle;
    final total = (after.kernel - before.kernel) + (after.user - before.user);
    if (total <= 0) return 0;
    return ((total - idle) / total).clamp(0.0, 1.0);
  }

  static final _kernel32 = DynamicLibrary.open('kernel32.dll');

  static final _globalMemoryStatusEx = _kernel32
      .lookupFunction<
        Int32 Function(Pointer<_MemoryStatusEx>),
        int Function(Pointer<_MemoryStatusEx>)
      >('GlobalMemoryStatusEx');

  static final _getSystemTimes = _kernel32
      .lookupFunction<
        Int32 Function(Pointer<Uint64>, Pointer<Uint64>, Pointer<Uint64>),
        int Function(Pointer<Uint64>, Pointer<Uint64>, Pointer<Uint64>)
      >('GetSystemTimes');

  static ({int totalMb, int availableMb}) _memoryStatus() {
    final status = calloc<_MemoryStatusEx>();
    try {
      status.ref.dwLength = sizeOf<_MemoryStatusEx>();
      if (_globalMemoryStatusEx(status) == 0) {
        throw StateError('GlobalMemoryStatusEx failed');
      }
      const mb = 1024 * 1024;
      return (
        totalMb: status.ref.ullTotalPhys ~/ mb,
        availableMb: status.ref.ullAvailPhys ~/ mb,
      );
    } finally {
      calloc.free(status);
    }
  }

  static CpuTimes _systemTimes() {
    // FILETIMEs are two 32-bit halves of one little-endian 64-bit count.
    final times = calloc<Uint64>(3);
    try {
      if (_getSystemTimes(times, times + 1, times + 2) == 0) {
        throw StateError('GetSystemTimes failed');
      }
      return CpuTimes(idle: times[0], kernel: times[1], user: times[2]);
    } finally {
      calloc.free(times);
    }
  }
}

/// Cumulative CPU time from `GetSystemTimes`, in 100 ns units, summed over
/// every core since boot.
@visibleForTesting
class CpuTimes {
  const CpuTimes({
    required this.idle,
    required this.kernel,
    required this.user,
  });

  final int idle;
  final int kernel;
  final int user;
}

/// MEMORYSTATUSEX from sysinfoapi.h.
final class _MemoryStatusEx extends Struct {
  @Uint32()
  external int dwLength;
  @Uint32()
  external int dwMemoryLoad;
  @Uint64()
  external int ullTotalPhys;
  @Uint64()
  external int ullAvailPhys;
  @Uint64()
  external int ullTotalPageFile;
  @Uint64()
  external int ullAvailPageFile;
  @Uint64()
  external int ullTotalVirtual;
  @Uint64()
  external int ullAvailVirtual;
  @Uint64()
  external int ullAvailExtendedVirtual;
}
