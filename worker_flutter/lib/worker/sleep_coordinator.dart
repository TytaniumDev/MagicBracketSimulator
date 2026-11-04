import 'dart:async';

import 'package:flutter/foundation.dart';

import '../app_log.dart';
import '../system/idle_monitor.dart';
import '../system/sleep_guard.dart';
import '../telemetry.dart';

/// Decides when the worker keeps the computer awake and when it steps
/// aside so the computer can sleep.
///
/// With Keep computer awake off (the default):
///   - while any sim runs, the computer is held awake so the sim can
///     finish and its lease and report requests don't stall mid-flight;
///   - once the user has been idle as long as the OS sleep timer, the
///     worker is [paused]: it takes no new sims, lets the running ones
///     finish, then releases the hold so the computer sleeps;
///   - when the user is back, the pause ends and claiming resumes.
///
/// With Keep computer awake on, the computer is held awake the whole time
/// the engine runs, and the worker never pauses.
///
/// A computer set to never sleep never pauses either. A failed OS read
/// leaves the worker running (and is sent to Sentry once per run).
class SleepCoordinator {
  SleepCoordinator({
    required SleepGuard guard,
    required IdleMonitor idle,
    required bool Function() keepAwake,
    required int Function() activeSims,
    required void Function(bool paused) onPausedChanged,
    this.interval = const Duration(seconds: 30),
  }) : _guard = guard,
       _idle = idle,
       _keepAwake = keepAwake,
       _activeSims = activeSims,
       _onPausedChanged = onPausedChanged;

  final SleepGuard _guard;
  final IdleMonitor _idle;
  final bool Function() _keepAwake;
  final int Function() _activeSims;
  final void Function(bool paused) _onPausedChanged;

  /// How often the user's idle time is checked.
  final Duration interval;

  Timer? _timer;
  bool _running = false;
  bool _paused = false;
  bool _held = false;

  /// Serializes [update] and [syncHold] so a hold and a release can't
  /// interleave.
  Future<void> _queue = Future.value();

  bool _reportedIdleFailure = false;
  bool _reportedGuardFailure = false;

  /// True while the worker should take no new sims because the computer
  /// is due to sleep.
  bool get paused => _paused;

  /// Start checking every [interval]. Completes after the first check, so
  /// a computer that is already due to sleep pauses before any claim.
  Future<void> start() {
    _running = true;
    _timer ??= Timer.periodic(interval, (_) => unawaited(update()));
    return update();
  }

  /// Stop checking, end any pause and release the hold.
  Future<void> stop() {
    _running = false;
    _timer?.cancel();
    _timer = null;
    return _serialize(() async {
      _setPaused(false);
      await _applyHold(false);
    });
  }

  /// Re-check whether the computer is due to sleep, then hold or release.
  Future<void> update() => _serialize(() async {
    if (!_running) return;
    _setPaused(!_keepAwake() && await _sleepIsDue());
    await _applyHold(_wantHold);
  });

  /// Hold or release for the current sim count and setting, without
  /// re-reading idle time. Called when a sim starts or ends.
  Future<void> syncHold() => _serialize(() => _applyHold(_wantHold));

  /// Sims still finishing after [stop] don't take the hold back.
  bool get _wantHold => _running && (_keepAwake() || _activeSims() > 0);

  Future<void> _serialize(Future<void> Function() action) {
    final next = _queue.then((_) => action());
    _queue = next.catchError((_) {});
    return next;
  }

  void _setPaused(bool paused) {
    if (paused == _paused) return;
    _paused = paused;
    AppLog.event(
      TelemetryCategory.engineRuntime,
      paused
          ? 'sleep: computer is due to sleep, taking no new sims'
          : 'sleep: user is back, taking sims again',
    );
    _onPausedChanged(paused);
  }

  /// True when the user has been idle at least as long as the OS sleep
  /// timer, which is when the computer would sleep if nothing held it.
  Future<bool> _sleepIsDue() async {
    try {
      final sleepAfter = await _idle.sleepAfter();
      if (sleepAfter == null || sleepAfter == Duration.zero) return false;
      final idleFor = await _idle.userIdle();
      return idleFor != null && idleFor >= sleepAfter;
    } catch (e, st) {
      debugPrint('SleepCoordinator idle read failed: $e\n$st');
      if (!_reportedIdleFailure) {
        _reportedIdleFailure = true;
        await Telemetry.captureError(
          e,
          st,
          category: TelemetryCategory.engineRuntime,
          extra: {'phase': 'sleep_idle_read'},
        );
      }
      return false;
    }
  }

  Future<void> _applyHold(bool hold) async {
    if (hold == _held) return;
    try {
      if (hold) {
        await _guard.hold();
      } else {
        await _guard.release();
      }
      _held = hold;
      AppLog.event(
        TelemetryCategory.engineRuntime,
        hold
            ? 'sleep: keeping the computer awake'
            : 'sleep: letting the computer sleep',
      );
    } catch (e, st) {
      debugPrint('SleepCoordinator ${hold ? 'hold' : 'release'} failed: $e');
      if (!_reportedGuardFailure) {
        _reportedGuardFailure = true;
        await Telemetry.captureError(
          e,
          st,
          category: TelemetryCategory.engineRuntime,
          extra: {'phase': hold ? 'sleep_hold' : 'sleep_release'},
        );
      }
    }
  }
}
