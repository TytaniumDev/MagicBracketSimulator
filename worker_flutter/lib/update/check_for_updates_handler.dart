import 'package:flutter/services.dart';

/// Handles calls on the `magic_bracket/auto_updater` channel, which the
/// macOS "Check for Updates…" menu item (MainFlutterWindow.swift) uses.
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
      onCheckStarted();
      await checkForUpdates();
    } catch (e, st) {
      await onError(e, st);
      throw PlatformException(code: 'CHECK_FAILED', message: e.toString());
    }
  }
}
