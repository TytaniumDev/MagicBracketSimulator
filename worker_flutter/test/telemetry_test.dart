import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:worker_flutter/telemetry.dart';

void main() {
  group('TelemetryCategory.tagValue', () {
    test('renders as snake_case', () {
      expect(TelemetryCategory.boot.tagValue, 'boot');
      expect(TelemetryCategory.firebaseInit.tagValue, 'firebase_init');
      expect(TelemetryCategory.signIn.tagValue, 'sign_in');
      expect(TelemetryCategory.installer.tagValue, 'installer');
      expect(TelemetryCategory.engineStart.tagValue, 'engine_start');
      expect(TelemetryCategory.engineRuntime.tagValue, 'engine_runtime');
      expect(TelemetryCategory.autoUpdater.tagValue, 'auto_updater');
      expect(TelemetryCategory.tray.tagValue, 'tray');
    });
  });

  group('scrubPii', () {
    test('redacts email-shaped values in event extras', () {
      final event = SentryEvent(message: const SentryMessage('hi')).copyWith(
        extra: <String, dynamic>{
          'note': 'user contacted me at someone@example.com about it',
          'okField': 'no pii here',
        },
      );

      final scrubbed = scrubPii(event);

      expect(scrubbed, isNotNull);
      expect(scrubbed!.extra!['note'], contains('[redacted-email]'));
      expect(scrubbed.extra!['note'], isNot(contains('someone@example.com')));
      expect(scrubbed.extra!['okField'], 'no pii here');
    });

    test('redacts known PII keys', () {
      final event = SentryEvent(message: const SentryMessage('hi')).copyWith(
        extra: <String, dynamic>{
          'email': 'a@b.com',
          'uid': 'xyz',
          'displayName': 'Tyler',
          'user_id': '42',
          'safe': 'keep me',
        },
      );

      final scrubbed = scrubPii(event);

      expect(scrubbed!.extra!['email'], '[redacted]');
      expect(scrubbed.extra!['uid'], '[redacted]');
      expect(scrubbed.extra!['displayName'], '[redacted]');
      expect(scrubbed.extra!['user_id'], '[redacted]');
      expect(scrubbed.extra!['safe'], 'keep me');
    });

    test('replaces user with redacted placeholder', () {
      final event = SentryEvent(
        message: const SentryMessage('hi'),
        user: SentryUser(id: 'abc', email: 'x@y.com'),
      );

      final scrubbed = scrubPii(event);

      expect(scrubbed, isNotNull);
      // sentry-dart's SentryEvent.user is final + copyWith treats null
      // as "no change", so we replace rather than clear. The
      // identifying fields all become '[redacted]'.
      expect(scrubbed!.user!.email, isNull);
      expect(scrubbed.user!.id, '[redacted]');
    });

    test('redacts email-shaped values inside breadcrumb data', () {
      final event = SentryEvent(
        message: const SentryMessage('hi'),
        breadcrumbs: [
          Breadcrumb(
            category: 'sign_in',
            message: 'attempt',
            data: <String, dynamic>{
              'note': 'tried someone@example.com',
              'email': 'pii@example.com',
              'safe': 'ok',
            },
          ),
        ],
      );

      final scrubbed = scrubPii(event)!;
      final crumbData = scrubbed.breadcrumbs!.single.data!;
      expect(crumbData['note'], contains('[redacted-email]'));
      expect(crumbData['email'], '[redacted]');
      expect(crumbData['safe'], 'ok');
    });
  });
}
