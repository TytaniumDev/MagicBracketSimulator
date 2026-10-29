import 'dart:async';

import 'package:auto_updater/auto_updater.dart';

/// Reports auto-updater failures that would otherwise never leave the
/// native updater.
///
/// Sparkle (macOS) and WinSparkle (Windows) only surface errors through
/// the plugin's event stream, which nothing reads unless a listener is
/// registered. This listener forwards them to [onError].
///
/// Sparkle also aborts every "no update found" check with an error
/// (`SUNoUpdateError`) right after the update-not-available event. That
/// one is expected and is skipped.
///
/// [watchUserCheck] arms a watchdog for a user-initiated check. Sparkle
/// drops a check without any event or UI when the updater never started
/// or another check is still running, which is exactly what a menu
/// click that "does nothing" looks like. If no updater event arrives
/// within [userCheckTimeout], [onError] is told so.
class UpdaterTelemetry with UpdaterListener {
  UpdaterTelemetry({
    required this.onError,
    this.userCheckTimeout = const Duration(seconds: 30),
  });

  final void Function(String message) onError;
  final Duration userCheckTimeout;

  bool _lastCheckFoundNoUpdate = false;
  Timer? _userCheckWatchdog;

  void watchUserCheck() {
    _userCheckWatchdog?.cancel();
    _userCheckWatchdog = Timer(userCheckTimeout, () {
      _userCheckWatchdog = null;
      onError(
        'User-initiated update check produced no updater activity '
        'within ${userCheckTimeout.inSeconds}s',
      );
    });
  }

  void dispose() {
    _userCheckWatchdog?.cancel();
    _userCheckWatchdog = null;
  }

  void _sawActivity() {
    _userCheckWatchdog?.cancel();
    _userCheckWatchdog = null;
  }

  @override
  void onUpdaterError(UpdaterError? error) {
    _sawActivity();
    if (_lastCheckFoundNoUpdate) {
      _lastCheckFoundNoUpdate = false;
      return;
    }
    onError('Updater error: ${error?.message ?? '(no message)'}');
  }

  @override
  void onUpdaterCheckingForUpdate(Appcast? appcast) {
    _sawActivity();
    _lastCheckFoundNoUpdate = false;
  }

  @override
  void onUpdaterUpdateAvailable(AppcastItem? appcastItem) {
    _sawActivity();
    _lastCheckFoundNoUpdate = false;
  }

  @override
  void onUpdaterUpdateNotAvailable(UpdaterError? error) {
    _sawActivity();
    _lastCheckFoundNoUpdate = true;
  }

  @override
  void onUpdaterUpdateDownloaded(AppcastItem? appcastItem) => _sawActivity();

  @override
  void onUpdaterBeforeQuitForUpdate(AppcastItem? appcastItem) =>
      _sawActivity();
}
