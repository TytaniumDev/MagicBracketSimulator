import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/system/system_stats.dart';
import 'package:worker_flutter/worker/adaptive_capacity.dart';

void main() {
  final t0 = DateTime(2026, 11, 3, 12);
  const roomy = SystemLoad(cpuBusy: 0.5, availableMemoryMb: 8192);

  AdaptiveCapacity controller({int limit = 10, int start = 4}) =>
      AdaptiveCapacity(limit: limit, start: start);

  test('starts at the given value, clamped to 1 and the limit', () {
    expect(controller(start: 4).target, 4);
    expect(controller(start: 20).target, 10);
    expect(controller(start: 0).target, 1);
  });

  group('raising', () {
    test('adds one sim when every slot is busy and there is room', () {
      final c = controller();
      expect(c.update(roomy, activeSims: 4, now: t0), 5);
    });

    test('holds while slots are free (no work to fill them)', () {
      final c = controller();
      expect(c.update(roomy, activeSims: 2, now: t0), 4);
    });

    test('waits for the settle time between raises', () {
      final c = controller();
      c.update(roomy, activeSims: 4, now: t0);
      final soon = t0.add(const Duration(seconds: 30));
      expect(c.update(roomy, activeSims: 5, now: soon), 5);
      final later = t0.add(const Duration(seconds: 60));
      expect(c.update(roomy, activeSims: 5, now: later), 6);
    });

    test('holds when CPU is between the raise and lower thresholds', () {
      final c = controller();
      const busy = SystemLoad(cpuBusy: 0.85, availableMemoryMb: 8192);
      expect(c.update(busy, activeSims: 4, now: t0), 4);
    });

    test('holds when RAM has no room for another JVM', () {
      final c = controller();
      const tight = SystemLoad(cpuBusy: 0.5, availableMemoryMb: 2000);
      expect(c.update(tight, activeSims: 4, now: t0), 4);
    });

    test('never goes above the hardware limit', () {
      final c = controller(limit: 4, start: 4);
      expect(c.update(roomy, activeSims: 4, now: t0), 4);
    });
  });

  group('lowering', () {
    test('drops to one under the running sims when CPU is pegged', () {
      final c = controller(start: 8);
      const pegged = SystemLoad(cpuBusy: 0.99, availableMemoryMb: 8192);
      expect(c.update(pegged, activeSims: 8, now: t0), 7);
      // Running sims still 8: hold at 7 rather than dropping every reading.
      final next = t0.add(const Duration(seconds: 15));
      expect(c.update(pegged, activeSims: 8, now: next), 7);
      // One finished and the pressure is still there: down one more.
      final after = t0.add(const Duration(seconds: 30));
      expect(c.update(pegged, activeSims: 7, now: after), 6);
    });

    test('drops when free RAM runs low, even if CPU is fine', () {
      final c = controller(start: 8);
      const lowRam = SystemLoad(cpuBusy: 0.4, availableMemoryMb: 512);
      expect(c.update(lowRam, activeSims: 8, now: t0), 7);
    });

    test('never goes below 1', () {
      final c = controller(start: 1);
      const pegged = SystemLoad(cpuBusy: 1.0, availableMemoryMb: 100);
      expect(c.update(pegged, activeSims: 1, now: t0), 1);
      expect(c.update(pegged, activeSims: 0, now: t0), 1);
    });

    test('a drop restarts the settle time before the next raise', () {
      final c = controller(start: 8);
      const pegged = SystemLoad(cpuBusy: 0.99, availableMemoryMb: 8192);
      c.update(pegged, activeSims: 8, now: t0);
      final soon = t0.add(const Duration(seconds: 30));
      expect(c.update(roomy, activeSims: 7, now: soon), 7);
    });
  });
}
