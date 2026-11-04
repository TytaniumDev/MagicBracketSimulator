import 'dart:async';

import 'package:flutter/foundation.dart';

import '../system/system_stats.dart';
import '../telemetry.dart';
import 'adaptive_capacity.dart';

/// Runs Auto mode: samples [stats] every [interval], feeds each reading to
/// an [AdaptiveCapacity], and calls [onTarget] when the target changes.
class CapacityAutopilot {
  CapacityAutopilot({
    required SystemStats stats,
    required AdaptiveCapacity controller,
    required int Function() activeSims,
    required void Function(int target) onTarget,
    this.interval = const Duration(seconds: 5),
    DateTime Function()? clock,
  }) : _stats = stats,
       _controller = controller,
       _activeSims = activeSims,
       _onTarget = onTarget,
       _clock = clock ?? DateTime.now;

  final SystemStats _stats;
  final AdaptiveCapacity _controller;
  final int Function() _activeSims;
  final void Function(int target) _onTarget;
  final DateTime Function() _clock;

  /// Time between readings.
  final Duration interval;

  Timer? _timer;
  bool _ticking = false;

  /// Only the first failed reading per run goes to Sentry; a broken OS
  /// call would otherwise send one event every [interval].
  bool _reportedFailure = false;

  /// How many sims to run at once now.
  int get target => _controller.target;

  void start() {
    _timer ??= Timer.periodic(interval, (_) => unawaited(tick()));
    // Prime readings that measure CPU between calls.
    unawaited(tick());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// Take one reading and update the target.
  @visibleForTesting
  Future<void> tick() async {
    if (_ticking) return;
    _ticking = true;
    try {
      final load = await _stats.sample();
      if (load == null) return;
      final before = _controller.target;
      final after = _controller.update(
        load,
        activeSims: _activeSims(),
        now: _clock(),
      );
      if (after != before) _onTarget(after);
    } catch (e, st) {
      debugPrint('CapacityAutopilot reading failed: $e\n$st');
      if (!_reportedFailure) {
        _reportedFailure = true;
        await Telemetry.captureError(
          e,
          st,
          category: TelemetryCategory.engineRuntime,
          extra: {'phase': 'auto_capacity_sample'},
        );
      }
    } finally {
      _ticking = false;
    }
  }
}
