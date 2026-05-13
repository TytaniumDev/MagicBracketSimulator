import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:worker_flutter/launch/mode_picker_screen.dart';

/// The mode picker is the first screen a brand-new install sees and
/// the routing decision made here decides whether `WorkerEngine`
/// (cloud) or `OfflineRunner` boots. The persistence round-trip is
/// what keeps the picker from re-appearing on every launch once the
/// user has chosen, so a regression here is silently annoying.
void main() {
  setUp(() {
    // `shared_preferences` has an in-test memory backend; reset between
    // cases so cross-test leakage doesn't fake a passing round-trip.
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  group('LaunchMode prefs serialization', () {
    test('round-trips cloud and offline through prefsValue/fromPrefs', () {
      for (final mode in LaunchMode.values) {
        final raw = mode.prefsValue;
        expect(LaunchModeName.fromPrefs(raw), mode);
      }
    });

    test('fromPrefs returns null for unknown / null values', () {
      expect(LaunchModeName.fromPrefs(null), isNull);
      expect(LaunchModeName.fromPrefs(''), isNull);
      expect(
        LaunchModeName.fromPrefs('hybrid'),
        isNull,
        reason:
            'unknown strings must surface as null so a corrupted prefs '
            'value falls back to the picker UI instead of throwing',
      );
    });
  });

  group('readRememberedLaunchMode', () {
    test('returns null when nothing has been saved', () async {
      expect(await readRememberedLaunchMode(), isNull);
    });

    test('returns the saved mode after a direct prefs write', () async {
      // Bypass the widget — the helpers are also called from
      // `_routeToMode` at boot before any UI is mounted, so they must
      // work standalone.
      SharedPreferences.setMockInitialValues({kLaunchModePrefsKey: 'cloud'});
      expect(await readRememberedLaunchMode(), LaunchMode.cloud);

      SharedPreferences.setMockInitialValues({kLaunchModePrefsKey: 'offline'});
      expect(await readRememberedLaunchMode(), LaunchMode.offline);
    });
  });

  group('clearRememberedLaunchMode', () {
    test('removes the key so future reads see null', () async {
      SharedPreferences.setMockInitialValues({kLaunchModePrefsKey: 'cloud'});
      expect(await readRememberedLaunchMode(), LaunchMode.cloud);

      await clearRememberedLaunchMode();
      expect(
        await readRememberedLaunchMode(),
        isNull,
        reason:
            '"Switch to offline" must wipe the cloud preference so the '
            'next launch re-shows the picker rather than silently '
            'bouncing back to the prior mode',
      );
    });

    test('is a no-op when nothing is set', () async {
      // Defensive: a first-launch user has nothing to clear, but the
      // helper might still get called during boot orchestration.
      await expectLater(clearRememberedLaunchMode(), completes);
      expect(await readRememberedLaunchMode(), isNull);
    });
  });
}
