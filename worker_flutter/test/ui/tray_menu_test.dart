import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/ui/tray_setup.dart';
import 'package:worker_flutter/worker/worker_engine.dart';

void main() {
  List<String?> keys({EngineState? state, bool canCheckForUpdates = false}) =>
      trayMenuItems(
        state: state,
        canCheckForUpdates: canCheckForUpdates,
      ).map((item) => item.key).toList();

  group('trayMenuItems', () {
    test('offers Check for updates when the updater is wired up', () {
      expect(keys(state: EngineState.initial(), canCheckForUpdates: true), [
        'status',
        null,
        'show',
        'toggle',
        'check_updates',
        null,
        'quit',
      ]);
    });

    test('leaves it out when there is no update check', () {
      expect(
        keys(state: EngineState.initial()),
        isNot(contains('check_updates')),
      );
    });

    test(
      'before the engine starts, shows only dashboard, updates and quit',
      () {
        expect(keys(canCheckForUpdates: true), [
          'show',
          'check_updates',
          null,
          'quit',
        ]);
      },
    );
  });
}
