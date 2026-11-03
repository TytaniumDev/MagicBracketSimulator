import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/worker/sim_capacity.dart';
import 'package:worker_flutter/worker/system_memory.dart';

void main() {
  group('SimCapacity.limitFor', () {
    test('memory limits a 16-thread, 16 GB machine', () {
      // (16384 - 3072) ~/ 1280 = 10, below the 16 threads.
      expect(
        SimCapacity.limitFor(logicalCores: 16, totalMemoryMb: 16384),
        10,
      );
    });

    test('cores limit a machine with plenty of RAM', () {
      expect(SimCapacity.limitFor(logicalCores: 8, totalMemoryMb: 65536), 8);
    });

    test('never goes below 1 on a tiny machine', () {
      expect(SimCapacity.limitFor(logicalCores: 2, totalMemoryMb: 2048), 1);
    });

    test('never goes above the absolute max', () {
      expect(
        SimCapacity.limitFor(logicalCores: 128, totalMemoryMb: 512 * 1024),
        SimCapacity.absoluteMax,
      );
    });

    test('unknown RAM limits by cores, capped at the fallback', () {
      expect(SimCapacity.limitFor(logicalCores: 4), 4);
      expect(
        SimCapacity.limitFor(logicalCores: 24),
        SimCapacity.fallbackLimit,
      );
    });

    test('an unreadable core count falls back', () {
      expect(
        SimCapacity.limitFor(logicalCores: 0, totalMemoryMb: 65536),
        SimCapacity.fallbackLimit,
      );
    });
  });

  group('SystemMemory.parseBytesAsMb', () {
    test('parses sysctl / PowerShell byte counts', () {
      expect(SystemMemory.parseBytesAsMb('17179869184\n'), 16384);
      expect(SystemMemory.parseBytesAsMb('  34359738368\r\n'), 32768);
    });

    test('rejects empty, non-numeric and non-positive output', () {
      expect(SystemMemory.parseBytesAsMb(''), isNull);
      expect(SystemMemory.parseBytesAsMb('error: unknown oid'), isNull);
      expect(SystemMemory.parseBytesAsMb('0'), isNull);
    });
  });
}
