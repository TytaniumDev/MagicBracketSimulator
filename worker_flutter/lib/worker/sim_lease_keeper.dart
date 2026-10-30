import 'dart:async';

import '../app_log.dart';
import '../telemetry.dart';
import 'sim_api.dart';

/// Keeps one running sim's lease alive (see `api/lib/sim-lease.ts` for the
/// API's lease rules).
///
/// Calls [extend] every [interval] (well inside the API's 3-minute lease).
/// A failed call is logged and retried on the next tick. When the API says
/// the job was cancelled or the sim is no longer ours, the keeper stops and
/// calls [onEnd] once.
class SimLeaseKeeper {
  SimLeaseKeeper({
    required this.extend,
    required this.onEnd,
    this.interval = const Duration(seconds: 60),
  });

  final Future<SimLeaseStatus> Function() extend;
  final void Function(SimLeaseStatus status) onEnd;
  final Duration interval;

  Timer? _timer;

  void start() {
    _timer ??= Timer.periodic(interval, (_) => _tick());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _tick() async {
    final SimLeaseStatus status;
    try {
      status = await extend();
    } catch (e, st) {
      AppLog.event(TelemetryCategory.engineRuntime, 'lease extend failed: $e');
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.engineRuntime,
        extra: {'phase': 'lease_extend'},
      );
      return;
    }
    if (_timer == null || status == SimLeaseStatus.extended) return;
    stop();
    onEnd(status);
  }
}
