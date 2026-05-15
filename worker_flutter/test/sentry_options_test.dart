import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:worker_flutter/sentry_setup.dart';

void main() {
  group('configureSentryOptions', () {
    test('disables performance + profiling, enables session tracking', () {
      final options = SentryFlutterOptions();

      configureSentryOptions(
        options,
        dsn: 'https://example@sentry.io/1',
        release: 'worker_flutter@0.1.0+42',
        gitSha: 'abc1234',
      );

      expect(options.tracesSampleRate, 0);
      // ignore: experimental_member_use
      expect(options.profilesSampleRate, 0);
      expect(options.enableAutoSessionTracking, isTrue);
      expect(options.sendDefaultPii, isFalse);
      expect(options.release, 'worker_flutter@0.1.0+42');
      expect(options.dist, 'abc1234');
      expect(options.environment, kDebugMode ? 'development' : 'production');
      expect(options.autoSessionTrackingInterval, const Duration(seconds: 30));
    });

    test('empty DSN still applies safety flags (no-op mode)', () {
      final options = SentryFlutterOptions();

      configureSentryOptions(
        options,
        dsn: '',
        release: 'worker_flutter@dev',
        gitSha: 'local',
      );

      expect(options.dsn, '');
      expect(options.tracesSampleRate, 0);
      // ignore: experimental_member_use
      expect(options.profilesSampleRate, 0);
      expect(options.sendDefaultPii, isFalse);
    });

    test('beforeSend is wired up', () {
      final options = SentryFlutterOptions();

      configureSentryOptions(
        options,
        dsn: 'https://example@sentry.io/1',
        release: 'r',
        gitSha: 's',
      );

      expect(options.beforeSend, isNotNull);
    });
  });
}
