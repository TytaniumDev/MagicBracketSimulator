import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/update/check_for_updates_handler.dart';

void main() {
  group('CheckForUpdatesHandler', () {
    late int checks;
    late int starts;
    late List<Object> errors;

    CheckForUpdatesHandler handler({Object? failWith}) {
      return CheckForUpdatesHandler(
        checkForUpdates: () async {
          checks++;
          if (failWith != null) throw failWith;
        },
        onCheckStarted: () => starts++,
        onError: (e, st) async => errors.add(e),
      );
    }

    setUp(() {
      checks = 0;
      starts = 0;
      errors = [];
    });

    test('runs a check and starts watching it', () async {
      await handler().handle(const MethodCall('checkForUpdates'));

      expect(checks, 1);
      expect(starts, 1);
      expect(errors, isEmpty);
    });

    test('reports a failed check and returns it to the menu', () async {
      final failure = Exception('updater not started');

      await expectLater(
        handler(failWith: failure).handle(const MethodCall('checkForUpdates')),
        throwsA(
          isA<PlatformException>()
              .having((e) => e.code, 'code', 'CHECK_FAILED')
              .having((e) => e.message, 'message', contains('not started')),
        ),
      );
      expect(errors, [failure]);
    });

    test('check() reports a failure and rethrows it', () async {
      final failure = Exception('feed unreachable');

      await expectLater(handler(failWith: failure).check(), throwsA(failure));
      expect(starts, 1);
      expect(errors, [failure]);
    });

    test('rejects unknown methods', () async {
      await expectLater(
        handler().handle(const MethodCall('nope')),
        throwsA(isA<MissingPluginException>()),
      );
      expect(checks, 0);
    });
  });
}
