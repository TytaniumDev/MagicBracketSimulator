import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/system/system_stats.dart';
import 'package:worker_flutter/worker/adaptive_capacity.dart';
import 'package:worker_flutter/worker/capacity_autopilot.dart';

void main() {
  late FakeSystemStats stats;
  late List<int> targets;
  late int active;

  CapacityAutopilot autopilot() => CapacityAutopilot(
    stats: stats,
    controller: AdaptiveCapacity(limit: 8, start: 2, settle: Duration.zero),
    activeSims: () => active,
    onTarget: targets.add,
  );

  setUp(() {
    stats = FakeSystemStats();
    targets = [];
    active = 2;
  });

  test('reports each target change', () async {
    stats.load = const SystemLoad(cpuBusy: 0.3, availableMemoryMb: 8192);
    final pilot = autopilot();
    await pilot.tick();
    expect(targets, [3]);
    expect(pilot.target, 3);
  });

  test('stays quiet when the target holds', () async {
    stats.load = const SystemLoad(cpuBusy: 0.85, availableMemoryMb: 8192);
    await autopilot().tick();
    expect(targets, isEmpty);
  });

  test('skips readings the OS cannot give yet', () async {
    stats.load = null;
    final pilot = autopilot();
    await pilot.tick();
    expect(targets, isEmpty);
    expect(pilot.target, 2);
  });

  test('a failed reading keeps the target and does not throw', () async {
    stats.error = StateError('GetSystemTimes failed');
    final pilot = autopilot();
    await pilot.tick();
    expect(targets, isEmpty);
    expect(pilot.target, 2);
  });
}

class FakeSystemStats implements SystemStats {
  SystemLoad? load;
  Object? error;

  @override
  Future<int?> totalMemoryMb() async => 16384;

  @override
  Future<SystemLoad?> sample() async {
    if (error != null) throw error!;
    return load;
  }
}
