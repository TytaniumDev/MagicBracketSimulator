import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/system/macos_system_stats.dart';
import 'package:worker_flutter/system/windows_system_stats.dart';

void main() {
  group('MacSystemStats.parseVmStatAvailableMb', () {
    test('sums free, inactive and speculative pages', () {
      const output = '''
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               65536.
Pages active:                            400000.
Pages inactive:                          131072.
Pages speculative:                        65536.
Pages throttled:                              0.
Pages wired down:                        150000.
''';
      // (65536 + 131072 + 65536) pages * 16 KB = 4096 MB.
      expect(MacSystemStats.parseVmStatAvailableMb(output), 4096);
    });

    test('throws on output it does not recognise', () {
      expect(
        () => MacSystemStats.parseVmStatAvailableMb('vm_stat: not found'),
        throwsFormatException,
      );
      expect(
        () => MacSystemStats.parseVmStatAvailableMb(
          'Mach Virtual Memory Statistics: (page size of 4096 bytes)\n'
          'Pages free: 10.\n',
        ),
        throwsFormatException,
      );
    });
  });

  group('MacSystemStats.parsePsCpuBusy', () {
    test('sums per-process CPU and divides by the cores', () {
      const output = ' 95.0\n 100.0\n  5.0\n  0.0\n';
      // 200% of one core on 8 cores = 25% busy.
      expect(MacSystemStats.parsePsCpuBusy(output, 8), closeTo(0.25, 1e-9));
    });

    test('clamps to 1 and ignores blank lines', () {
      expect(MacSystemStats.parsePsCpuBusy('400\n\n400\n', 4), 1.0);
      expect(MacSystemStats.parsePsCpuBusy('', 4), 0.0);
    });
  });

  group('WindowsSystemStats.cpuBusyBetween', () {
    test('busy is kernel + user minus idle, over kernel + user', () {
      const before = CpuTimes(idle: 1000, kernel: 1500, user: 500);
      // 1000 ticks passed: 600 kernel (of which 300 idle), 400 user.
      const after = CpuTimes(idle: 1300, kernel: 2100, user: 900);
      expect(WindowsSystemStats.cpuBusyBetween(before, after), 0.7);
    });

    test('is 0 when no time passed', () {
      const t = CpuTimes(idle: 1, kernel: 2, user: 3);
      expect(WindowsSystemStats.cpuBusyBetween(t, t), 0);
    });
  });
}
