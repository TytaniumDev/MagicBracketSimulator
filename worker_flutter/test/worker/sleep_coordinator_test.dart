import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/system/idle_monitor.dart';
import 'package:worker_flutter/system/sleep_guard.dart';
import 'package:worker_flutter/worker/sleep_coordinator.dart';

/// A [SleepGuard] that records whether it is held.
class FakeSleepGuard implements SleepGuard {
  bool held = false;
  int holds = 0;

  @override
  Future<void> hold() async {
    held = true;
    holds++;
  }

  @override
  Future<void> release() async {
    held = false;
  }
}

/// An [IdleMonitor] with settable readings.
class FakeIdleMonitor implements IdleMonitor {
  Duration? idle = Duration.zero;
  Duration? sleepTimer = const Duration(minutes: 10);
  Object? error;

  @override
  Future<Duration?> userIdle() async {
    if (error != null) throw error!;
    return idle;
  }

  @override
  Future<Duration?> sleepAfter() async {
    if (error != null) throw error!;
    return sleepTimer;
  }
}

void main() {
  late FakeSleepGuard guard;
  late FakeIdleMonitor idle;
  late bool keepAwake;
  late int activeSims;
  late List<bool> pauseChanges;
  late SleepCoordinator coordinator;

  setUp(() {
    guard = FakeSleepGuard();
    idle = FakeIdleMonitor();
    keepAwake = false;
    activeSims = 0;
    pauseChanges = [];
    coordinator = SleepCoordinator(
      guard: guard,
      idle: idle,
      keepAwake: () => keepAwake,
      activeSims: () => activeSims,
      onPausedChanged: pauseChanges.add,
      // Tests drive update() themselves.
      interval: const Duration(hours: 1),
    );
  });

  tearDown(() => coordinator.stop());

  test('holds the computer awake only while sims run', () async {
    await coordinator.start();
    expect(guard.held, isFalse);

    activeSims = 1;
    await coordinator.syncHold();
    expect(guard.held, isTrue);

    activeSims = 0;
    await coordinator.syncHold();
    expect(guard.held, isFalse);
    expect(coordinator.paused, isFalse);
  });

  test('pauses once the user is idle as long as the sleep timer, '
      'finishes running sims, then lets the computer sleep', () async {
    activeSims = 2;
    await coordinator.start();
    expect(guard.held, isTrue);

    idle.idle = const Duration(minutes: 10);
    await coordinator.update();
    expect(coordinator.paused, isTrue);
    expect(pauseChanges, [true]);
    expect(guard.held, isTrue, reason: 'running sims still finish');

    activeSims = 0;
    await coordinator.syncHold();
    expect(guard.held, isFalse);
    expect(coordinator.paused, isTrue);

    idle.idle = const Duration(seconds: 5);
    await coordinator.update();
    expect(coordinator.paused, isFalse);
    expect(pauseChanges, [true, false]);
  });

  test('Keep computer awake holds while idle and never pauses', () async {
    keepAwake = true;
    idle.idle = const Duration(hours: 2);
    await coordinator.start();

    expect(guard.held, isTrue);
    expect(coordinator.paused, isFalse);
    expect(pauseChanges, isEmpty);
  });

  test('turning Keep computer awake on ends a pause', () async {
    idle.idle = const Duration(hours: 2);
    await coordinator.start();
    expect(coordinator.paused, isTrue);

    keepAwake = true;
    await coordinator.update();
    expect(coordinator.paused, isFalse);
    expect(guard.held, isTrue);
  });

  test('a computer set to never sleep never pauses', () async {
    idle.sleepTimer = Duration.zero;
    idle.idle = const Duration(hours: 5);
    await coordinator.start();
    expect(coordinator.paused, isFalse);
  });

  test('an OS without idle readings never pauses', () async {
    idle
      ..sleepTimer = null
      ..idle = null;
    await coordinator.start();
    expect(coordinator.paused, isFalse);
  });

  test('a failed idle read keeps the worker running', () async {
    idle.error = StateError('ioreg failed');
    await coordinator.start();
    expect(coordinator.paused, isFalse);
  });

  test('stop releases, and sims ending afterwards do not hold again', () async {
    keepAwake = true;
    activeSims = 1;
    await coordinator.start();
    expect(guard.held, isTrue);

    await coordinator.stop();
    expect(guard.held, isFalse);

    activeSims = 0;
    await coordinator.syncHold();
    expect(guard.held, isFalse);
    expect(guard.holds, 1);
  });
}
