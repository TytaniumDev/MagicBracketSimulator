import '../system/system_stats.dart';
import 'sim_capacity.dart';

/// Decides how many sims to run in Auto mode, from live CPU and RAM
/// readings. Pure: no timers or I/O, so every rule is unit-testable.
///
/// - **Raise** by one when every slot is busy, CPU is under
///   [raiseBelowCpu], and there is RAM for one more JVM on top of
///   [minFreeMemoryMb]. A new JVM takes a while to reach its real CPU and
///   memory use, so raises are at least [settle] apart.
/// - **Lower** to one under the sims running now when CPU is over
///   [lowerAboveCpu] or free RAM is under [minFreeMemoryMb]. Running sims
///   are never stopped; the worker just claims no more until enough of
///   them finish. Holding at one under the running count (rather than
///   dropping one per reading) sheds one sim per finished sim while the
///   pressure lasts.
/// - Otherwise hold.
///
/// The target always stays within 1 and the hardware [limit].
class AdaptiveCapacity {
  AdaptiveCapacity({
    required this.limit,
    required int start,
    this.settle = const Duration(seconds: 10),
  }) : _target = start.clamp(1, limit);

  /// The hardware limit ([SimCapacity.limitFor]).
  final int limit;

  /// Least time after a change before the target is raised again.
  final Duration settle;

  /// Raise only while CPU use is below this.
  static const raiseBelowCpu = 0.75;

  /// Lower when CPU use is above this (say, the user starts a game).
  static const lowerAboveCpu = 0.95;

  /// Free RAM to keep on top of the running sims.
  static const minFreeMemoryMb = 1024;

  int _target;
  DateTime? _lastChange;

  /// How many sims to run at once now.
  int get target => _target;

  /// Feed one reading taken at [now] while [activeSims] sims were running,
  /// and return the new [target].
  int update(
    SystemLoad load, {
    required int activeSims,
    required DateTime now,
  }) {
    final overloaded =
        load.cpuBusy > lowerAboveCpu ||
        load.availableMemoryMb < minFreeMemoryMb;
    if (overloaded) {
      final lowered = (activeSims - 1).clamp(1, limit);
      if (lowered < _target) _change(lowered, now);
      return _target;
    }

    final saturated = activeSims >= _target;
    final roomForOne =
        load.cpuBusy < raiseBelowCpu &&
        load.availableMemoryMb >= SimCapacity.memoryPerSimMb + minFreeMemoryMb;
    final settled =
        _lastChange == null || now.difference(_lastChange!) >= settle;
    if (saturated && roomForOne && settled && _target < limit) {
      _change(_target + 1, now);
    }
    return _target;
  }

  void _change(int target, DateTime now) {
    _target = target;
    _lastChange = now;
  }
}
