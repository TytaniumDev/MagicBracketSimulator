import 'package:auto_updater/auto_updater.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/update/updater_telemetry.dart';

void main() {
  group('UpdaterTelemetry', () {
    late List<String> errors;
    late UpdaterTelemetry telemetry;

    setUp(() {
      errors = [];
      telemetry = UpdaterTelemetry(onError: errors.add);
    });

    test('reports updater errors', () {
      telemetry.onUpdaterError(UpdaterError('appcast download failed'));

      expect(errors, ['Updater error: appcast download failed']);
    });

    test('skips the abort that follows "no update found"', () {
      telemetry
        ..onUpdaterUpdateNotAvailable(UpdaterError('up to date'))
        ..onUpdaterError(UpdaterError('up to date'));

      expect(errors, isEmpty);
    });

    test('reports errors in the next check after "no update found"', () {
      telemetry
        ..onUpdaterUpdateNotAvailable(null)
        ..onUpdaterError(null)
        ..onUpdaterError(UpdaterError('feed unreachable'));

      expect(errors, ['Updater error: feed unreachable']);
    });

    test('reports a user check that gets no updater activity', () {
      fakeAsync((async) {
        telemetry.watchUserCheck();
        async.elapse(const Duration(seconds: 31));

        expect(errors, hasLength(1));
        expect(errors.single, contains('no updater activity'));
      });
    });

    test('stays quiet when the user check gets updater activity', () {
      fakeAsync((async) {
        telemetry.watchUserCheck();
        telemetry.onUpdaterCheckingForUpdate(null);
        async.elapse(const Duration(minutes: 1));

        expect(errors, isEmpty);
      });
    });
  });
}
