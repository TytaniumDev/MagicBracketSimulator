import 'package:auto_updater/auto_updater.dart';

/// Quits the app when the updater is about to run the new installer.
///
/// On Windows, WinSparkle launches the downloaded installer and then
/// fires its shutdown-request callback, which `auto_updater` surfaces as
/// [onUpdaterBeforeQuitForUpdate]. The app is expected to exit on its
/// own at that point. Because the window's close button only hides the
/// window to the tray, nothing else makes the process exit, and the
/// installer stalls waiting for `MagicBracketWorker.exe` to close.
///
/// [onQuit] runs the same shutdown as the tray's "Quit" menu item.
class QuitForUpdateListener with UpdaterListener {
  QuitForUpdateListener({required this.onQuit});

  final Future<void> Function() onQuit;

  bool _quitting = false;

  @override
  void onUpdaterBeforeQuitForUpdate(AppcastItem? appcastItem) {
    // WinSparkle can fire the shutdown request more than once if the
    // user retries the install; only the first one starts the shutdown.
    if (_quitting) return;
    _quitting = true;
    onQuit();
  }

  @override
  void onUpdaterError(UpdaterError? error) {}

  @override
  void onUpdaterCheckingForUpdate(Appcast? appcast) {}

  @override
  void onUpdaterUpdateAvailable(AppcastItem? appcastItem) {}

  @override
  void onUpdaterUpdateNotAvailable(UpdaterError? error) {}

  @override
  void onUpdaterUpdateDownloaded(AppcastItem? appcastItem) {}
}
