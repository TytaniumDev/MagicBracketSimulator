import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/system/macos_idle_monitor.dart';
import 'package:worker_flutter/system/windows_idle_monitor.dart';

void main() {
  group('MacIdleMonitor.parseHidIdleTime', () {
    test('reads nanoseconds since the last input', () {
      const output = '''
+-o IOHIDSystem  <class IOHIDSystem, id 0x100000453, registered>
    {
      "HIDIdleTime" = 125000000000
      "HIDParameters" = {"HIDDefaultParameters"=Yes}
    }
''';
      expect(
        MacIdleMonitor.parseHidIdleTime(output),
        const Duration(seconds: 125),
      );
    });

    test('throws when the property is missing', () {
      expect(
        () => MacIdleMonitor.parseHidIdleTime('+-o IOHIDSystem'),
        throwsFormatException,
      );
    });
  });

  group('MacIdleMonitor.parsePmsetSleep', () {
    const output = '''
System-wide power settings:
Currently in use:
 standby              1
 Sleep On Power Button 1
 hibernatefile        /var/vm/sleepimage
 powernap             1
 disksleep            10
 sleep                15 (sleep prevented by caffeinate, powerd)
 displaysleep         5
''';

    test('reads the sleep timer in minutes, not disksleep or displaysleep', () {
      expect(
        MacIdleMonitor.parsePmsetSleep(output),
        const Duration(minutes: 15),
      );
    });

    test('0 means never sleep', () {
      expect(
        MacIdleMonitor.parsePmsetSleep(' displaysleep 10\n sleep 0\n'),
        Duration.zero,
      );
    });

    test('throws when there is no sleep line', () {
      expect(
        () => MacIdleMonitor.parsePmsetSleep(' displaysleep 10\n'),
        throwsFormatException,
      );
    });
  });

  group('WindowsIdleMonitor.parsePowercfgSleep', () {
    test('reads the plugged-in and battery timeouts in seconds', () {
      const output =
          'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)\r\n'
          '  GUID Alias: SCHEME_BALANCED\r\n'
          '  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)\r\n'
          '    GUID Alias: SUB_SLEEP\r\n'
          '    Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Sleep after)\r\n'
          '      GUID Alias: STANDBYIDLE\r\n'
          '      Minimum Possible Setting: 0x00000000\r\n'
          '      Maximum Possible Setting: 0xffffffff\r\n'
          '      Possible Settings increment: 0x00000001\r\n'
          '      Possible Settings units: Seconds\r\n'
          '    Current AC Power Setting Index: 0x00000708\r\n'
          '    Current DC Power Setting Index: 0x00000384\r\n';
      final timeouts = WindowsIdleMonitor.parsePowercfgSleep(output);
      expect(timeouts.pluggedIn, const Duration(minutes: 30));
      expect(timeouts.battery, const Duration(minutes: 15));
    });

    test('throws when the timeouts are missing', () {
      expect(
        () => WindowsIdleMonitor.parsePowercfgSleep('Invalid parameters'),
        throwsFormatException,
      );
    });
  });
}
