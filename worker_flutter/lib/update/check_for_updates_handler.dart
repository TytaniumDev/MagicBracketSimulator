import 'package:flutter/services.dart';

/// Runs user-initiated update checks: from the macOS "Check for Updates…"
/// menu item (MainFlutterWindow.swift) over the `magic_bracket/auto_updater`
/// channel, and from the Windows tray menu via [check].
///
/// A failed check is passed to [onError] and then returned to Swift as
/// a [PlatformException], so the menu item can show an alert instead of
/// doing nothing.
class CheckForUpdatesHandler {
  CheckForUpdatesHandler({
    required this.checkForUpdates,
    required this.onCheckStarted,
    required this.onError,
  });

  final Future<void> Function() checkForUpdates;
  final void Function() onCheckStarted;
  final Future<void> Function(Object error, StackTrace stack) onError;

  Future<void> handle(MethodCall call) async {
    if (call.method != 'checkForUpdates') {
      // Unknown method on a channel we control both ends of. Bubble a
      // real error so a wiring mistake surfaces instead of being dropped.
      throw MissingPluginException(
        'magic_bracket/auto_updater: unknown method "${call.method}"',
      );
    }
    try {
      await check();
    } catch (e) {
      throw PlatformException(code: 'CHECK_FAILED', message: e.toString());
    }
  }

  /// Runs a user-initiated check. A failure is passed to [onError] and
  /// rethrown. Used directly by the Windows tray menu, which has no
  /// platform channel in between.
  Future<void> check() async {
    try {
      onCheckStarted();
      await checkForUpdates();
    } catch (e, st) {
      await onError(e, st);
      rethrow;
    }
  }
}
