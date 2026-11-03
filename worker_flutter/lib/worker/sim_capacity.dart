import 'dart:math' as math;

/// How many Forge sims this machine can run at once without paging.
///
/// Each sim is one Java process. CPU and memory run out differently:
///
/// - **CPU** can be oversubscribed safely. The OS time-slices the JVMs, so
///   extra sims just run slower and throughput levels off near 100% CPU.
///   A Forge game averages about one core (it peaks at 1.5–2), so we allow
///   one sim per logical core.
/// - **Memory** cannot. Once the JVMs outgrow physical RAM the OS pages
///   them to disk, and garbage collection on a paged heap stalls the whole
///   machine. So memory sets a hard ceiling: what is left after
///   [reservedMemoryMb], divided by [memoryPerSimMb].
///
/// Measured in October and November 2026: a Forge 2.0.15 JVM sits at
/// 0.6–1.2 GB (Windows, 8 sims at once) and peaks at 1.0–1.7 GB on long
/// games. Peaks rarely line up, so the budget is set above the typical
/// size rather than at the worst peak.
class SimCapacity {
  SimCapacity._();

  /// Memory budgeted for one Forge JVM.
  static const memoryPerSimMb = 1280;

  /// Memory left for the OS, this app, and whatever else the user runs.
  static const reservedMemoryMb = 3072;

  /// Used when the core count or RAM can't be read.
  static const fallbackLimit = 8;

  /// The most sims [limitFor] will ever allow, whatever the hardware.
  static const absoluteMax = 32;

  /// The parallel sim limit for a machine with [logicalCores] and
  /// [totalMemoryMb] of physical RAM. A null [totalMemoryMb] (RAM unknown)
  /// limits by cores only, capped at [fallbackLimit]. Always at least 1.
  static int limitFor({required int logicalCores, int? totalMemoryMb}) {
    final byCpu = logicalCores > 0 ? logicalCores : fallbackLimit;
    final byMemory = totalMemoryMb == null
        ? fallbackLimit
        : (totalMemoryMb - reservedMemoryMb) ~/ memoryPerSimMb;
    return math.min(byCpu, byMemory).clamp(1, absoluteMax);
  }
}
