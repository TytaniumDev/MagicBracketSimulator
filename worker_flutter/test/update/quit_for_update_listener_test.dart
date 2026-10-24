import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/update/quit_for_update_listener.dart';

void main() {
  group('QuitForUpdateListener', () {
    test('quits when the updater asks the app to shut down', () {
      var calls = 0;
      final listener = QuitForUpdateListener(onQuit: () async => calls++);

      listener.onUpdaterBeforeQuitForUpdate(null);

      expect(calls, 1);
    });

    test('quits only once for repeated shutdown requests', () {
      var calls = 0;
      final listener = QuitForUpdateListener(onQuit: () async => calls++);

      listener.onUpdaterBeforeQuitForUpdate(null);
      listener.onUpdaterBeforeQuitForUpdate(null);

      expect(calls, 1);
    });

    test('ignores other updater events', () {
      var calls = 0;
      final listener = QuitForUpdateListener(onQuit: () async => calls++);

      listener
        ..onUpdaterError(null)
        ..onUpdaterCheckingForUpdate(null)
        ..onUpdaterUpdateAvailable(null)
        ..onUpdaterUpdateNotAvailable(null)
        ..onUpdaterUpdateDownloaded(null);

      expect(calls, 0);
    });
  });
}
